const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Pool (Render Environment Variables සඳහා සකස් කර ඇත)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mobile_shop_db',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306, // මෙතැනට DB_PORT එක එකතු කර ඇත
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto-create Tables on Startup
async function initDB() {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS products (
            product_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            name TEXT,
            brand VARCHAR(100),
            color VARCHAR(50),
            category VARCHAR(100),
            cost_price DECIMAL(10,2),
            selling_price DECIMAL(10,2),
            stock INT,
            product_code VARCHAR(100),
            imei VARCHAR(100)
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS sales (
            sale_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            customer_name VARCHAR(100),
            customer_phone VARCHAR(50),
            sale_type VARCHAR(50) DEFAULT 'Product',
            payment_method VARCHAR(50),
            total_amount DECIMAL(10,2),
            items_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS repairs (
            repair_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            customer_name VARCHAR(100),
            customer_phone VARCHAR(50),
            device_model VARCHAR(100),
            issue_description TEXT,
            advance_cost DECIMAL(10,2),
            total_cost DECIMAL(10,2),
            status VARCHAR(50) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS credits (
            credit_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            customer_name VARCHAR(100),
            customer_phone VARCHAR(50),
            item_details TEXT,
            total_amount DECIMAL(10,2),
            paid_amount DECIMAL(10,2) DEFAULT 0,
            status VARCHAR(50) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS consignments (
            consignment_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            other_shop_name VARCHAR(100),
            item_name VARCHAR(100),
            imei VARCHAR(100),
            wholesale_price DECIMAL(10,2),
            status VARCHAR(50) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS repair_parts (
            part_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id VARCHAR(50),
            part_name VARCHAR(100),
            supplier_name VARCHAR(100),
            supplier_phone VARCHAR(50),
            cost DECIMAL(10,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("Database tables verified/created successfully.");
    } catch (err) {
        console.error("Database initialization error:", err.message);
    }
}
initDB();

// API Routes
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    res.json({ success: true, user: { shop_id: '1', shop_name: custom_shop_name || 'SHA MOBILE', shop_phone: shop_phone || '0720641351', username } });
});

// Products - Get all products regardless of strict shop_id mismatch
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM products');
        res.json(rows);
    } catch (err) { res.json([]); }
});

// Sales - Get all sales regardless of strict shop_id mismatch
app.get('/api/sales', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM sales ORDER BY sale_id DESC');
        const formatted = rows.map(s => {
            let itemsParsed = [];
            try { itemsParsed = JSON.parse(s.items_json || '[]'); } catch(e) {}
            let dateObj = new Date(s.created_at || Date.now());
            let year_only = dateObj.getFullYear().toString();
            let month_only = `${year_only}-${String(dateObj.getMonth()+1).padStart(2,'0')}`;
            let date_only = `${year_only}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
            return { ...s, items: itemsParsed, year_only, month_only, date_only, formatted_date: dateObj.toLocaleString(), delete_key: s.sale_id };
        });
        res.json(formatted);
    } catch (err) { res.json([]); }
});

// Repairs - Get all repairs
app.get('/api/repairs', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM repairs');
        res.json(rows);
    } catch (err) { res.json([]); }
});

// Credits - Get all credits
app.get('/api/credits', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM credits');
        res.json(rows);
    } catch (err) { res.json([]); }
});

// Consignments - Get all consignments
app.get('/api/consignments', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM consignments');
        res.json(rows);
    } catch (err) { res.json([]); }
});

// Repair Parts - Get all repair parts
app.get('/api/repair-parts', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM repair_parts');
        res.json(rows);
    } catch (err) { res.json([]); }
});

app.post('/api/products', async (req, res) => {
    try {
        const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
        const product_code = 'PRD' + Math.floor(1000 + Math.random() * 9000);
        await db.query('INSERT INTO products (shop_id, name, brand, color, category, cost_price, selling_price, stock, product_code, imei) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [shop_id || '1', name, brand, color, category, cost_price, selling_price, stock, product_code, imei]);
        res.json({ success: true, product_code });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM products WHERE product_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sales APIs - Updated to fetch all records robustly
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id;
    
    // shop_id නොමැති නම් හෝ සියලුම ෂොප්ස්වල සේල්ස් පෙන්වීමට අවශ්‍ය නම් shop_id ෆිල්ටර් වීම ලිහිල් කළ හැක
    const query = shopId ? 'SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC' : 'SELECT * FROM sales ORDER BY created_at DESC';
    const params = shopId ? [shopId] : [];

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const formatted = (results || []).map((row, index) => {
            const realId = row.sale_id || (index + 1);
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            
            const pad = (n) => String(n).padStart(2, '0');
            const sqlDateTime = `${cDate.getFullYear()}-${pad(cDate.getMonth() + 1)}-${pad(cDate.getDate())} ${pad(cDate.getHours())}:${pad(cDate.getMinutes())}:${pad(cDate.getSeconds())}`;

            return {
                ...row,
                sale_id: realId,
                delete_key: sqlDateTime,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                total_amount: parseFloat(row.total_amount || 0),
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7),
                year_only: cDate.getFullYear().toString(),
                items: [] // Prevent undefined errors on frontend
            };
        });
        res.json(formatted);
    });
});

        res.json(formatted);
    } catch (err) {
        console.error("Sales fetch error:", err.message);
        res.json([]);
    }
});

app.post('/api/sales', async (req, res) => {
    try {
        const { shop_id, customer_name, customer_phone, payment_method, total_amount, items } = req.body;
        let sale_type = 'Product';
        if(items && items.length > 0) {
            if(items[0].type === 'repair') sale_type = 'Repair';
            else if(items[0].type === 'exchange') sale_type = 'Exchange';
        }
        await db.query('INSERT INTO sales (shop_id, customer_name, customer_phone, sale_type, payment_method, total_amount, items_json) VALUES (?,?,?,?,?,?,?)',
            [shop_id || '1', customer_name, customer_phone, sale_type, payment_method, total_amount, JSON.stringify(items)]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sales/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM sales WHERE sale_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Repairs
app.get('/api/repairs', async (req, res) => {
    try {
        const shop_id = req.query.shop_id || '1';
        const [rows] = await db.query('SELECT * FROM repairs WHERE shop_id = ?', [shop_id]);
        res.json(rows);
    } catch (err) { res.json([]); }
});

app.post('/api/repairs', async (req, res) => {
    try {
        const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
        await db.query('INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?,?,?,?,?,?,?)',
            [shop_id || '1', customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/repairs/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM repairs WHERE repair_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/repairs/:id', async (req, res) => {
    try {
        const { status } = req.body;
        await db.query('UPDATE repairs SET status = ? WHERE repair_id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Credits, Consignments, Repair Parts
app.get('/api/credits', async (req, res) => {
    try {
        const shop_id = req.query.shop_id || '1';
        const [rows] = await db.query('SELECT * FROM credits WHERE shop_id = ?', [shop_id]);
        res.json(rows);
    } catch (err) { res.json([]); }
});

app.post('/api/credits', async (req, res) => {
    try {
        const { shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount } = req.body;
        await db.query('INSERT INTO credits (shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount) VALUES (?,?,?,?,?,?)',
            [shop_id || '1', customer_name, customer_phone, item_details, total_amount, paid_amount || 0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/credits/:id', async (req, res) => {
    try {
        const { additional_payment } = req.body;
        await db.query('UPDATE credits SET paid_amount = paid_amount + ? WHERE credit_id = ?', [additional_payment, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/consignments', async (req, res) => {
    try {
        const shop_id = req.query.shop_id || '1';
        const [rows] = await db.query('SELECT * FROM consignments WHERE shop_id = ?', [shop_id]);
        res.json(rows);
    } catch (err) { res.json([]); }
});

app.post('/api/consignments', async (req, res) => {
    try {
        const { shop_id, other_shop_name, item_name, imei, wholesale_price } = req.body;
        await db.query('INSERT INTO consignments (shop_id, other_shop_name, item_name, imei, wholesale_price) VALUES (?,?,?,?,?)',
            [shop_id || '1', other_shop_name, item_name, imei, wholesale_price]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/consignments/:id', async (req, res) => {
    try {
        const { status } = req.body;
        await db.query('UPDATE consignments SET status = ? WHERE consignment_id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/repair-parts', async (req, res) => {
    try {
        const shop_id = req.query.shop_id || '1';
        const [rows] = await db.query('SELECT * FROM repair_parts WHERE shop_id = ?', [shop_id]);
        res.json(rows);
    } catch (err) { res.json([]); }
});

app.post('/api/repair-parts', async (req, res) => {
    try {
        const { shop_id, part_name, supplier_name, supplier_phone, cost } = req.body;
        await db.query('INSERT INTO repair_parts (shop_id, part_name, supplier_name, supplier_phone, cost) VALUES (?,?,?,?,?)',
            [shop_id || '1', part_name, supplier_name, supplier_phone, cost]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/restore', async (req, res) => {
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));