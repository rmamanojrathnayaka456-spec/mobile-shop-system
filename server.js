const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// HTML/CSS Static Files Serve කිරීම
app.use(express.static(__dirname));

// MySQL Connection Pool එකක් සාදාගැනීම (Connection drop වීම වැළැක්වීමට)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'railway',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Database connection එක පරීක්ෂා කිරීම
db.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('Connected to MySQL Database Pool!');
        connection.release();
    }
});

// Root URL එකට ගිය විට index.html open වීම
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Add New Product
app.post('/api/products', (req, res) => {
    const { name, category, cost_price, selling_price, stock_quantity } = req.body;
    const query = 'INSERT INTO products (name, category, cost_price, selling_price, stock_quantity) VALUES (?, ?, ?, ?, ?)';
    
    db.query(query, [name, category, cost_price, selling_price, stock_quantity], (err, result) => {
        if (err) {
            console.error('Error inserting product:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: 'Product added successfully!', productId: result.insertId });
    });
});

// Port configuration for Railway
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});