const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto create required tables on start
db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        payment_method VARCHAR(50),
        sale_type VARCHAR(20) DEFAULT 'Product',
        discount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        amount_paid DECIMAL(10, 2) DEFAULT 0,
        balance_due DECIMAL(10, 2) DEFAULT 0,
        items LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, () => {});

app.get('/api/sales', (req, res) => {
    db.query('SELECT * FROM sales ORDER BY sale_id DESC', (err, results) => {
        if (err) {
            console.error("Database error fetching sales:", err);
            return res.status(500).json({ error: err.message });
        }
        
        console.log("-> Sales fetched from database count:", results ? results.length : 0);
        const list = Array.isArray(results) ? results : [];
        const formatted = list.map((row) => {
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            const pad = (n) => String(n).padStart(2, '0');

            let parsedItems = [];
            try {
                parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
            } catch (e) { parsedItems = []; }

            const actualId = row.sale_id !== undefined && row.sale_id !== null ? row.sale_id : row.id;

            return {
                ...row,
                sale_id: actualId,
                id: actualId,
                items: parsedItems,
                delete_key: actualId,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                amount_paid: row.amount_paid !== null ? parseFloat(row.amount_paid) : parseFloat(row.total_amount || 0),
                balance_due: row.balance_due !== null ? parseFloat(row.balance_due) : 0,
                formatted_date: cDate.toLocaleString(),
                date_only: `${cDate.getFullYear()}-${pad(cDate.getMonth() + 1)}-${pad(cDate.getDate())}`,
                month_only: `${cDate.getFullYear()}-${pad(cDate.getMonth() + 1)}`
            };
        });
        res.json(formatted);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, amount_paid, balance_due, items } = req.body;
    
    if (!shop_id) return res.status(400).json({ error: 'Missing shop_id' });

    let containsRepair = false, containsProduct = false;
    if (items && Array.isArray(items)) {
        items.forEach(item => {
            if (item.type === 'repair') containsRepair = true;
            if (item.type === 'product' || item.type === 'exchange' || !item.type) containsProduct = true;
        });
    }
    
    let sale_type = 'Product';
    if (containsRepair && containsProduct) sale_type = 'Mixed';
    else if (containsRepair) sale_type = 'Repair';

    const finalAmountPaid = amount_paid !== undefined ? amount_paid : total_amount;
    const finalBalanceDue = balance_due !== undefined ? balance_due : 0;
    const itemsJson = JSON.stringify(items || []);

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, amount_paid, balance_due, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', sale_type, discount || 0, total_amount, finalAmountPaid, finalBalanceDue, itemsJson],
        (err, result) => {
            if (err) {
                console.error("Error inserting sale:", err);
                return res.status(500).json({ error: err.message });
            }
            console.log("-> Sale successfully added with ID:", result.insertId);
            res.json({ success: true, sale_id: result.insertId });
        }
    );
});

app.delete('/api/sales/:id', (req, res) => {
    const saleId = req.params.id;
    db.query('DELETE FROM sales WHERE sale_id = ? OR id = ?', [saleId, saleId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Removed successfully' });
    });
});

// Basic tables for products/repairs so app loads cleanly
db.query(`CREATE TABLE IF NOT EXISTS products (product_id INT AUTO_INCREMENT PRIMARY KEY, shop_id INT NOT NULL, product_code VARCHAR(10), name VARCHAR(100) NOT NULL, brand VARCHAR(50), color VARCHAR(50), category VARCHAR(50), cost_price DECIMAL(10, 2), selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0, stock INT DEFAULT 1, imei VARCHAR(50))`, () => {});
db.query(`CREATE TABLE IF NOT EXISTS repairs (repair_id INT AUTO_INCREMENT PRIMARY KEY, shop_id INT NOT NULL, customer_name VARCHAR(100), customer_phone VARCHAR(20), device_model VARCHAR(100), issue_description TEXT, advance_cost DECIMAL(10, 2) DEFAULT 0, total_cost DECIMAL(10, 2) NOT NULL, status VARCHAR(50) DEFAULT 'Pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, () => {});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));