#!/usr/bin/env node
// ถอดรหัสไฟล์สำรองเป็น JSON อ่านได้: BACKUP_PASSPHRASE=... node restore-read.mjs firestore-2026-11-15.bsb > out.json
import fs from 'node:fs';
import {unpackJson} from './lib.mjs';
const f = process.argv[2]; if (!f || !process.env.BACKUP_PASSPHRASE) { console.error('ใช้: BACKUP_PASSPHRASE=... node restore-read.mjs <ไฟล์.bsb>'); process.exit(2); }
process.stdout.write(JSON.stringify(unpackJson(fs.readFileSync(f), process.env.BACKUP_PASSPHRASE), null, 1));
