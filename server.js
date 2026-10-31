const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Pool (Update with your MySQL credentials)
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'mobile_shop_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Helper to initialize database tables if they don't exist
async function initDB() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS shops (
                shop_id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE,
                password VARCHAR(255),
                shop_name VARCHAR(255),
                shop_phone VARCHAR(255)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS products (
                product_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                product_code VARCHAR(255),
                name TEXT,
                brand VARCHAR(255),
                category VARCHAR(255),
                color VARCHAR(255),
                cost_price DECIMAL(10,2),
                selling_price DECIMAL(10,2),
                stock INT,
                imei VARCHAR(255)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS sales (
                sale_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                payment_method VARCHAR(100),
                total_amount DECIMAL(10,2),
                sale_type VARCHAR(100) DEFAULT 'Product',
                items_json LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS repairs (
                repair_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                device_model VARCHAR(255),
                issue_description TEXT,
                advance_cost DECIMAL(10,2),
                total_cost DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS credits (
                credit_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                item_details TEXT,
                total_amount DECIMAL(10,2),
                paid_amount DECIMAL(10,2) DEFAULT 0,
                balance_due DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'Unpaid',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS consignments (
                consignment_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                other_shop_name VARCHAR(255),
                item_name VARCHAR(255),
                imei VARCHAR(255),
                wholesale_price DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'Out',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS repair_parts (
                part_id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT,
                part_name VARCHAR(255),
                supplier_name VARCHAR(255),
                supplier_phone VARCHAR(255),
                cost DECIMAL(10,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Database tables verified/initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err.message);
    }
}
initDB();

// --- API ROUTES ---

// Login / Register Shop
app.post('/api/login', async (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM shops WHERE username = ?', [username]);
        let shop;
        if (rows.length === 0) {
            const [result] = await db.query(
                'INSERT INTO shops (username, password, shop_name, shop_phone) VALUES (?, ?, ?, ?)',
                [username, password, custom_shop_name || 'SHA MOBILE', shop_phone || '0720641351']
            );
            shop = { shop_id: result.insertId, username, shop_name: custom_shop_name || 'SHA MOBILE', shop_phone: shop_phone || '0720641351' };
        } else {
            shop = rows[0];
            if (shop.password !== password) {
                return res.status(401).json({ success: false, error: 'Incorrect password!' });
            }
        }
        res.json({ success: true, user: shop });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Products API
app.get('/api/products', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [shop_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
    const { shop_id, name, brand, category, color, cost_price, selling_price, stock, imei } = req.body;
    try {
        const product_code = 'PRD' + Math.floor(100000 + Math.random() * 900000);
        const [result] = await db.query(
            'INSERT INTO products (shop_id, product_code, name, brand, category, color, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shop_id, product_code, name, brand, category, color, cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A']
        );
        res.json({ success: true, product_id: result.insertId, product_code });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id } = req.query;
    try {
        await db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [id, shop_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sales API
app.get('/api/sales', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY sale_id DESC', [shop_id]);
        const formatted = rows.map(s => {
            let itemsParsed = [];
            try { itemsParsed = JSON.parse(s.items_json || '[]'); } catch(e) {}
            
            let dateObj = new Date(s.created_at || Date.now());
            let year_only = dateObj.getFullYear().toString();
            let month_only = `${year_only}-${String(dateObj.getMonth()+1).padStart(2,'0')}`;
            let date_only = `${year_only}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
            
            return {
                ...s,
                items: itemsParsed,
                year_only,
                month_only,
                date_only,
                formatted_date: dateObj.toLocaleString(),
                delete_key: s.sale_id
            };
        });
        res.json(formatted);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sales', async (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, total_amount, items } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        let saleType = 'Product';
        if (items && items.length > 0) {
            if (items.some(i => i.type === 'repair')) saleType = 'Repair';
            else if (items.some(i => i.type === 'exchange')) saleType = 'Exchange';
        }

        const [result] = await connection.query(
            'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, total_amount, sale_type, items_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [shop_id, customer_name, customer_phone, payment_method, total_amount, saleType, JSON.stringify(items)]
        );

        // Deduct stock for product items
        if (items && Array.isArray(items)) {
            for (let item of items) {
                if (item.product_id && item.type === 'product') {
                    await connection.query(
                        'UPDATE products SET stock = stock - ? WHERE product_id = ? AND shop_id = ?',
                        [item.qty || 1, item.product_id, shop_id]
                    );
                }
            }
        }

        await connection.commit();
        connection.release();
        res.json({ success: true, sale_id: result.insertId });
    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sales/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id } = req.query;
    try {
        await db.query('DELETE FROM sales WHERE sale_id = ? AND shop_id = ?', [id, shop_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Repairs API
app.get('/api/repairs', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM repairs WHERE shop_id = ? ORDER BY repair_id DESC', [shop_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/repairs', async (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost || 0]
        );
        res.json({ success: true, repair_id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/repairs/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id, status } = req.body;
    try {
        await db.query('UPDATE repairs SET status = ? WHERE repair_id = ? AND shop_id = ?', [status, id, shop_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/repairs/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id } = req.query;
    try {
        await db.query('DELETE FROM repairs WHERE repair_id = ? AND shop_id = ?', [id, shop_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Credits API
app.get('/api/credits', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM credits WHERE shop_id = ? ORDER BY credit_id DESC', [shop_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/credits', async (req, res) => {
    const { shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount } = req.body;
    try {
        const paid = parseFloat(paid_amount || 0);
        const total = parseFloat(total_amount || 0);
        const balance_due = Math.max(0, total - paid);
        const status = balance_due === 0 ? 'Paid' : 'Unpaid';

        const [result] = await db.query(
            'INSERT INTO credits (shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount, balance_due, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [shop_id, customer_name, customer_phone, item_details, total, paid, balance_due, status]
        );
        res.json({ success: true, credit_id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/credits/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id, additional_payment } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM credits WHERE credit_id = ? AND shop_id = ?', [id, shop_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Credit record not found' });
        
        let credit = rows[0];
        let newPaid = parseFloat(credit.paid_amount || 0) + parseFloat(additional_payment || 0);
        let newBalance = Math.max(0, parseFloat(credit.total_amount) - newPaid);
        let newStatus = newBalance === 0 ? 'Paid' : 'Unpaid';

        await db.query(
            'UPDATE credits SET paid_amount = ?, balance_due = ?, status = ? WHERE credit_id = ? AND shop_id = ?',
            [newPaid, newBalance, newStatus, id, shop_id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Consignments API
app.get('/api/consignments', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM consignments WHERE shop_id = ? ORDER BY consignment_id DESC', [shop_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/consignments', async (req, res) => {
    const { shop_id, other_shop_name, item_name, imei, wholesale_price } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO consignments (shop_id, other_shop_name, item_name, imei, wholesale_price) VALUES (?, ?, ?, ?, ?)',
            [shop_id, other_shop_name, item_name, imei || 'N/A', wholesale_price || 0]
        );
        res.json({ success: true, consignment_id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/consignments/:id', async (req, res) => {
    const { id } = req.params;
    const { shop_id, status } = req.body;
    try {
        await db.query('UPDATE consignments SET status = ? WHERE consignment_id = ? AND shop_id = ?', [status, id, shop_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Repair Parts Sourcing API
app.get('/api/repair-parts', async (req, res) => {
    const { shop_id } = req.query;
    try {
        const [rows] = await db.query('SELECT * FROM repair_parts WHERE shop_id = ? ORDER BY part_id DESC', [shop_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/repair-parts', async (req, res) => {
    const { shop_id, part_name, supplier_name, supplier_phone, cost } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO repair_parts (shop_id, part_name, supplier_name, supplier_phone, cost) VALUES (?, ?, ?, ?, ?)',
            [shop_id, part_name, supplier_name, supplier_phone || 'N/A', cost || 0]
        );
        res.json({ success: true, part_id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restore Backup API
app.post('/api/restore', async (req, res) => {
    const { shop_id, products, sales, repairs } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        if (products && Array.isArray(products)) {
            for (let p of products) {
                await connection.query(
                    'INSERT INTO products (shop_id, product_code, name, brand, category, color, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [shop_id, p.product_code || 'PRD123', p.name, p.brand, p.category, p.color, p.cost_price, p.selling_price, p.stock, p.imei]
                );
            }
        }
        await connection.commit();
        connection.release();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mobile Shop Server is running on port ${PORT}`);
});