const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorizeAdminOnlyLegacy } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get('/doctor-stats', authenticate, authorizeAdminOnlyLegacy, async (req, res) => {
  try {
    const start = Date.now();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Single query execution offloading the aggregation entirely to PostgreSQL
    const reportData = await prisma.$queryRaw`
      SELECT 
        d.id,
        d.name,
        d.specialization,
        d.department,
        COALESCE(a.total_appointments, 0)::integer AS "totalAppointments",
        COALESCE(a.completed_appointments, 0)::integer AS "completedAppointments",
        COALESCE(a.cancelled_appointments, 0)::integer AS "cancelledAppointments",
        COALESCE(q.today_queue_size, 0)::integer AS "todayQueueSize",
        (COALESCE(a.completed_appointments, 0) * d."consultationFee")::double precision AS "revenue"
      FROM "Doctor" d
      LEFT JOIN (
        SELECT 
          "doctorId",
          COUNT(*) AS total_appointments,
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_appointments,
          COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_appointments
        FROM "Appointment"
        GROUP BY "doctorId"
      ) a ON d.id = a."doctorId"
      LEFT JOIN (
        SELECT 
          "doctorId",
          COUNT(*) AS today_queue_size
        FROM "QueueToken"
        WHERE "createdAt" >= ${today}
        GROUP BY "doctorId"
      ) q ON d.id = q."doctorId"
    `;

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      timeTakenMs: durationMs,
      data: reportData,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

module.exports = router;
