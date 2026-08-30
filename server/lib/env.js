// Tai bien moi truong tu server/.env ma khong can cai them thu vien.
// Gia tri da co trong he dieu hanh/VPS luon duoc uu tien, file .env chi
// tien cho may phat trien. File that da nam trong .gitignore.
'use strict';

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || process.env[match[1]] !== undefined) continue;

        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
    }
}

module.exports = { envPath };
