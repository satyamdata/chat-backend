import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// MySQL connection pool bana rahe hain
export const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',      // Apna MySQL username likhein (default root hota hai)
    password: '',  // Apna MySQL password likhein
    database: 'chat_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});