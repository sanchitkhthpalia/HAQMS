FROM node:18-slim

# Install OpenSSL for Prisma Engine
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 5000

CMD npx prisma db push && node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.patient.count().then(c => { if(c === 0) { console.log('Seeding DB...'); require('child_process').execSync('node prisma/seed.js', {stdio: 'inherit'}); } else { console.log('Database already has data. Skipping seed.'); } }).catch(e => { console.error(e); process.exit(1); })" && node src/index.js
