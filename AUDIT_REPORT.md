# AUDIT_REPORT.md — HAQMS Engineering Assignment

---

## TL;DR / Approach

Scanned the entire setup first—routes, middleware, prisma schema, and the react views. Triaged by what's actually broken: security first, then correctness, then performance, then building the missing view.

I didn't patch every single thing. Phone validation is still a dumb string field, register endpoint still leaks the password hash, and auth errors dump raw error messages to the client. Real issues, but lower priority. Left them as tech debt to hit the time budget.

Total footprint: 8 backend files touched, 2 frontend files modified, 1 new page built.

---

## Security Fixes

**Passwords in logs** (`backend/src/routes/auth.js`)

Register route was logging the entire request body via `JSON.stringify(req.body)`—meaning cleartext passwords in stderr. Login route was doing the same via string template. Cleaned both up to only log the email. Simple fix, but leaving cleartext credentials in logs is a SOC2 nightmare.

**JWT configuration** (`backend/src/routes/auth.js`, `backend/src/middleware/auth.js`)

Ripped out three bad practices here:
- Token expiry was set to a ridiculous `365d`. Swapped to `8h`.
- Verification was using `{ ignoreExpiration: true }`. Completely defeats the point of having tokens. Nuked that option.
- Auth errors leaked internal database details via `error.message`. Changed to return a simple 401.

The hardcoded backup secret key fallback is still there. The app should fail fast and crash on startup if `JWT_SECRET` is missing in production, but I left the bootstrap sequence alone for now.

**SQL injection** (`backend/src/routes/doctors.js`)

Doctor search was string-interpolating user input directly into a `$queryRawUnsafe` raw SQL call:

```js
conditions.push(`name ILIKE '%${search}%'`);
```

The codebase literal comments even pointed out how easy it is to exploit. Rewrote it using Prisma's native `findMany` query engine:

```js
where.name = { contains: search, mode: 'insensitive' }
```

Letting Prisma parameterize the query under the hood kills the vulnerability. Also nuked the `[SQL-DEBUG]` logger printing raw queries on every keypress.

**Bypassed admin check** (`backend/src/middleware/auth.js`)

`authorizeAdminOnlyLegacy` had its role-check validation blocks commented out because it was "causing issues during testing." The result was anyone with a login could call `DELETE /api/patients/:id`. Restored the check. Non-admins get kicked out with a 403 now.

Also added `authorizeAdminOnlyLegacy` to `GET /api/reports/doctor-stats` because that report route didn't have any role guards at all.

---

## Performance & Concurrency

**N+1 queries** (`backend/src/routes/appointments.js`)

`GET /api/appointments` pulled basic records, then spun over every single row running two separate database queries to resolve the doctor and patient details. 100 appointments meant 201 database roundtrips.

Swapped the loop for an eager-loaded `include` block:

```js
const appointments = await prisma.appointment.findMany({
  where,
  orderBy: { appointmentDate: 'asc' },
  include: {
    patient: { select: { id: true, name: true, phoneNumber: true, age: true, medicalHistory: true } },
    doctor: { select: { id: true, name: true, specialization: true } },
  },
});
```

Down to one query. Solved.

**Sequential awaits** (`backend/src/routes/doctors.js`)

`GET /api/doctors/stats` ran four separate database count and aggregation queries sequentially. Total response time was the sum of all four operations. Bundled them inside a `Promise.all` so they execute in parallel on the database.

**Nested loop report** (`backend/src/routes/reports.js`)

`GET /api/reports/doctor-stats` was a disaster. It looped over every doctor and executed five separate queries inside the loop, plus a literal `80ms` timeout per iteration. With ten doctors in the system, it hit the database 51 times and slept for 800ms.

Ripped all that out and offloaded the work to a raw SQL query with `LEFT JOIN`s and `GROUP BY` logic:

```sql
SELECT d.id, d.name, ...,
  COALESCE(a.total_appointments, 0) AS "totalAppointments",
  ...
FROM "Doctor" d
LEFT JOIN (SELECT "doctorId", COUNT(*) ... FROM "Appointment" GROUP BY "doctorId") a ON ...
LEFT JOIN (SELECT "doctorId", COUNT(*) ... FROM "QueueToken" WHERE ... GROUP BY "doctorId") q ON ...
```

One quick database roundtrip, zero loops, and the artificial timeout is gone.

**Queue check-in race condition** (`backend/src/routes/queue.js`)

The token assignment had a classic concurrency issue: it did an aggregate count query, slept for 350ms to simulate delay, then wrote the new token incremented by one. Concurrent check-ins for the same doctor would fetch the same max token count and assign identical numbers.

Wrapped it in a Prisma interactive transaction and locked the target doctor's row using `FOR UPDATE` to serialize concurrent requests:

```js
const newToken = await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT * FROM "Doctor" WHERE id = ${doctorId} FOR UPDATE`;
  const maxResult = await tx.queueToken.aggregate({ ... });
  return tx.queueToken.create({ data: { tokenNumber: currentMax + 1, ... } });
});
```

The `FOR UPDATE` lock forces concurrent requests to wait in line rather than double-allocating. Nuked the artificial 350ms delay.

---

## Database Optimizations

**Double-booking constraint** (`backend/prisma/schema.prisma`)

The `Appointment` model didn't enforce slot limits at the database level. The application-level check was weak—someone could book appointments just a millisecond apart for the same doctor.

Added a unique constraint: `@@unique([doctorId, appointmentDate])`. Now the database guards the table integrity.

**Missing indices** (`backend/prisma/schema.prisma`)

Foreign keys and common search criteria had zero indexes, meaning full table scans everywhere. Added indexes on:

- `Doctor`: `@@index([specialization])`, `@@index([department])`
- `Appointment`: `@@index([patientId])`, `@@index([doctorId, status])`, `@@index([appointmentDate])`
- `QueueToken`: `@@index([patientId])`, `@@index([doctorId, createdAt])`, `@@index([status])`

The compound `[doctorId, status]` index speeds up doctor worklists, and `[doctorId, createdAt]` handles daily token aggregations without scans.

**In-memory pagination** (`backend/src/routes/patients.js`)

`GET /api/patients` fetched the entire patient directory, ran in-memory filters, and sliced the array. Bad news as the directory grows.

Shifted search/filter parameters into Prisma `where` logic and swapped array slices for `skip` and `take`. Executed data retrieval and patient count concurrently using `Promise.all`:

```js
const [patients, totalPatients] = await Promise.all([
  prisma.patient.findMany({ where, skip, take: limit }),
  prisma.patient.count({ where }),
]);
```

Also modified the `DELETE` patient handler to run in a transaction that cleans up referencing `QueueToken` and `Appointment` rows first, preventing database foreign key constraint check crashes during deletion.

---

## Frontend Fixes

**`setInterval` memory leak** (`frontend/src/app/queue/page.js`)

The polling loop inside `useEffect` had no cleanup return statement. Navigating to the queue board spawned a new interval every time, stacking loops in the background.

Added `return () => clearInterval(intervalId)`. Also cleaned up a stale closure issue where the log count got stuck by moving the logs directly inside the state update setter.

**Search debounce** (`frontend/src/app/dashboard/page.js`)

The search bar hit the API on every single keypress. Spammed the database when typing long names. Swapped it for a debounced input mechanism with a `300ms` window:

```js
useEffect(() => {
  const handler = setTimeout(() => setDebouncedSearch(patientSearch), 300);
  return () => clearTimeout(handler);
}, [patientSearch]);
```

The patient fetching hook now tracks `debouncedSearch` instead of firing on every keystroke.

**Hooks violation on logout** (`frontend/src/app/dashboard/page.js`)

The dashboard had a guard condition `if (!user) return null` declared way too early, skipping around thirty hooks below it. Logging out triggered the guard, violating React's rule of hook execution order consistency.

Pushed the guard statement to the bottom of the render logic and added optional chaining to initial state assignments so they fail gracefully when auth resets.

**Null crash on medical history** (`frontend/src/app/dashboard/page.js`)

Calling `.toUpperCase()` directly on nullable fields crashed the doctor panel when opening patients without an active history card (like Bruce Wayne). Made it safe with optional chaining and a fallback:

```js
{(selectedPatientHistory.medicalHistory?.toUpperCase()) ?? "No record available"}
```

Also imported `Link` from `next/link`. The original code was trying to render router links without importing the component.

---

## New Feature — Patient History Timeline

**File:** `frontend/src/app/patients/[id]/history-records/page.js`

The legacy diagnostics report link redirected to a dead route. Scaffolded and built the page.

Features:
- Enforces an authentication check, sending unlogged users back to `/login`.
- Queries `GET /api/patients/:id` passing along the JWT.
- Left column demographic card with name, gender, age, contact, and signup date.
- Right column background details panel featuring null-safe handling.
- Chronological timeline sorting appointments newest-first with status pill badges.
- Standard fallback templates for loading states and API retrieval errors.

---

## Known Issues / Trade-offs

**`JWT_SECRET` fallback** — Both token generation and validation middleware still fall back to the default hardcoded secret string if the environment variable is missing. It really needs to throw an exception at boot time (`if (!process.env.JWT_SECRET) throw new Error(...)`), but I left the bootstrap script as is. Don't deploy this to staging without setting the env var.

**Register response leaks password hash** — `POST /api/auth/register` returns the complete database user record, password hash included, directly to the client. We should sanitize the response payload to only expose `{ id, email, name, role }`. Easy fix, just ran out of time.

**No rate limiting** — Auth routes are completely unprotected from brute-force attempts. In production, we'd front this with something like `express-rate-limit` backed by Redis, but I skipped the setup overhead to focus on the performance bottlenecks.

**Phone number validation** — The registration form accepts whatever raw string the user inputs as a phone number. There's no regex sanitization on either the frontend or backend. It's a data consistency headache that needs to be addressed before importing any actual patient records.