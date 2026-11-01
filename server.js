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

// Auto Create Tables & Columns
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        shop_phone VARCHAR(50) DEFAULT '',
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, () => {
    db.query("ALTER TABLE shops ADD COLUMN shop_phone VARCHAR(50) DEFAULT ''", () => {});
    for (let i = 1; i <= 10; i++) {
        db.query(`INSERT INTO shops (shop_id, shop_name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE shop_id=shop_id`, [i, `Shop ${i}`]);
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        shop_id INT NOT NULL
    )
`, () => {
    const defaultUsers = [
        ['system01', 'sysKey@01', 1], ['system02', 'mobPass@02', 2], ['system03', 'shopPin@03', 3],
        ['system04', 'posCode@04', 4], ['system05', 'storeKey@05', 5], ['system06', 'branch@06', 6],
        ['system07', 'login@07', 7], ['system08', 'access@08', 8], ['system09', 'secure@09', 9], ['system10', 'admin@10', 10]
    ];
    defaultUsers.forEach(user => {
        db.query(`INSERT INTO users (username, password, shop_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = VALUES(password)`, user);
    });
});

db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        product_code VARCHAR(10),
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50),
        color VARCHAR(50),
        category VARCHAR(50),
        cost_price DECIMAL(10, 2),
        selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        stock INT DEFAULT 1,
        imei VARCHAR(50)
    )
`);

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
        items LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS repairs (
        repair_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        device_model VARCHAR(100),
        issue_description TEXT,
        advance_cost DECIMAL(10, 2) DEFAULT 0,
        total_cost DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

// New Tables for Additional Features
db.query(`
    CREATE TABLE IF NOT EXISTS credit_sales (
        credit_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        item_details TEXT,
        total_amount DECIMAL(10, 2) NOT NULL,
        paid_amount DECIMAL(10, 2) DEFAULT 0,
        balance_due DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS repair_parts (
        part_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        part_name VARCHAR(100),
        supplier_name VARCHAR(100),
        supplier_phone VARCHAR(20),
        cost DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS consignment_items (
        consignment_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        other_shop_name VARCHAR(100),
        item_name VARCHAR(100),
        imei VARCHAR(50),
        wholesale_price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'At Other Shop',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

// Login API
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    db.query(`
        SELECT u.*, s.shop_name, s.shop_phone, s.status 
        FROM users u 
        JOIN shops s ON u.shop_id = s.shop_id 
        WHERE u.username = ? AND u.password = ?
    `, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        const user = results[0];
        if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account Locked.' });

        const finalShopName = custom_shop_name && custom_shop_name.trim() !== '' ? custom_shop_name.trim() : user.shop_name;
        const finalShopPhone = shop_phone && shop_phone.trim() !== '' ? shop_phone.trim() : (user.shop_phone || '');

        db.query('UPDATE shops SET shop_name = ?, shop_phone = ? WHERE shop_id = ?', [finalShopName, finalShopPhone, user.shop_id], () => {
            user.shop_name = finalShopName;
            user.shop_phone = finalShopPhone;
            res.json({ success: true, user });
        });
    });
});

// Products APIs
app.get('/api/products', (req, res) => {
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [req.query.shop_id || 1], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query(
        'INSERT INTO products (shop_id, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id || 1, name || 'Unknown', brand || 'N/A', color || 'N/A', category || 'General', cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const pId = result.insertId;
            const product_code = pId.toString().padStart(3, '0');
            db.query('UPDATE products SET product_code = ? WHERE product_id = ?', [product_code, pId], () => {
                res.json({ message: 'Product added successfully', product_id: pId, product_code });
            });
        }
    );
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id || 1], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY created_at DESC', [shopId], (err, results) => {
        if (err) return res.json([]);
        const list = Array.isArray(results) ? results : [];
        const formatted = list.map((row, index) => {
            const realId = row.sale_id || (index + 1);
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            let parsedItems = [];
            try { parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []); } catch (e) { parsedItems = []; }

            const pad = (n) => String(n).padStart(2, '0');
            const sqlDateTime = `${cDate.getFullYear()}-${pad(cDate.getMonth() + 1)}-${pad(cDate.getDate())} ${pad(cDate.getHours())}:${pad(cDate.getMinutes())}:${pad(cDate.getSeconds())}`;

            return {
                ...row,
                sale_id: realId,
                items: parsedItems,
                delete_key: sqlDateTime,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7),
                year_only: cDate.getFullYear().toString()
            };
        });
        res.json(formatted);
    });
});

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, items } = req.body;
    let containsRepair = false, containsProduct = false, containsExchange = false;
    if (items && Array.isArray(items)) {
        items.forEach(item => {
            if (item.type === 'repair') containsRepair = true;
            if (item.type === 'product') containsProduct = true;
            if (item.type === 'exchange') containsExchange = true;
        });
    }
    let sale_type = 'Product';
    if (containsExchange) sale_type = 'Exchange';
    else if (containsRepair && containsProduct) sale_type = 'Mixed';
    else if (containsRepair) sale_type = 'Repair';

    const finalShopId = shop_id || 1;
    const itemsJson = JSON.stringify(items || []);

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [finalShopId, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', sale_type, discount || 0, total_amount, itemsJson],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item.type === 'product' && item.product_id) {
                        db.query('UPDATE products SET stock = stock - ? WHERE product_id = ? AND shop_id = ?', [item.qty, item.product_id, finalShopId]);
                    } else if (item.type === 'repair' && item.repair_id) {
                        db.query('UPDATE repairs SET status = "Delivered" WHERE repair_id = ? AND shop_id = ?', [item.repair_id, finalShopId]);
                    } else if (item.type === 'exchange') {
                        db.query('INSERT INTO products (shop_id, name, brand, color, category, selling_price, stock, imei) VALUES (?, ?, ?, ?, "Used Phone", ?, 1, ?)',
                            [finalShopId, item.exchange_name, item.brand || 'Exchange', item.color || 'N/A', item.valuation, item.imei || 'N/A']);
                    }
                });
            }
            res.json({ message: 'Sale recorded', sale_id: result.insertId });
        }
    );
});

app.delete('/api/sales/:id', (req, res) => {
    const deleteKey = decodeURIComponent(req.params.id);
    const shopId = req.query.shop_id || 1;
    db.query('DELETE FROM sales WHERE created_at = ? AND shop_id = ? LIMIT 1', [deleteKey, shopId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Removed' });
    });
});

// Repairs APIs
app.get('/api/repairs', (req, res) => {
    db.query('SELECT repair_id AS id, repair_id, shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status, created_at FROM repairs WHERE shop_id = ? ORDER BY created_at DESC', [req.query.shop_id || 1], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shop_id || 1, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Repair added', repair_id: result.insertId });
        }
    );
});

app.put('/api/repairs/:id', (req, res) => {
    db.query('UPDATE repairs SET status = ? WHERE repair_id = ? AND shop_id = ?', [req.body.status, req.params.id, req.body.shop_id || 1], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Updated' });
    });
});

app.delete('/api/repairs/:id', (req, res) => {
    db.query('DELETE FROM repairs WHERE repair_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id || 1], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

// Credit Sales APIs
app.get('/api/credits', (req, res) => {
    db.query('SELECT * FROM credit_sales WHERE shop_id = ? ORDER BY credit_id DESC', [req.query.shop_id || 1], (err, results) => {
        if (err) return res.json([]);
        res.json(results || []);
    });
});

app.post('/api/credits', (req, res) => {
    const { shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount } = req.body;
    const balance = Math.max(0, parseFloat(total_amount) - parseFloat(paid_amount || 0));
    const status = balance === 0 ? 'Settled' : 'Pending';
    db.query('INSERT INTO credit_sales (shop_id, customer_name, customer_phone, item_details, total_amount, paid_amount, balance_due, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id || 1, customer_name, customer_phone, item_details, total_amount, paid_amount || 0, balance, status],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Credit record added', credit_id: result.insertId });
        }
    );
});

app.put('/api/credits/:id', (req, res) => {
    const { shop_id, additional_payment } = req.body;
    db.query('SELECT * FROM credit_sales WHERE credit_id = ? AND shop_id = ?', [req.params.id, shop_id || 1], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Not found' });
        const row = results.find(Boolean) || results[0];
        const newPaid = parseFloat(row.paid_amount || 0) + parseFloat(additional_payment || 0);
        const newBalance = Math.max(0, parseFloat(row.total_amount) - newPaid);
        const newStatus = newBalance === 0 ? 'Settled' : 'Pending';

        db.query('UPDATE credit_sales SET paid_amount = ?, balance_due = ?, status = ? WHERE credit_id = ? AND shop_id = ?',
            [newPaid, newBalance, newStatus, req.params.id, shop_id || 1], (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ message: 'Credit updated successfully' });
            });
    });
});

// Repair Parts Sourcing APIs
app.get('/api/repair-parts', (req, res) => {
    db.query('SELECT * FROM repair_parts WHERE shop_id = ? ORDER BY part_id DESC', [req.query.shop_id || 1], (err, results) => {
        if (err) return res.json([]);
        res.json(results || []);
    });
});

app.post('/api/repair-parts', (req, res) => {
    const { shop_id, part_name, supplier_name, supplier_phone, cost } = req.body;
    db.query('INSERT INTO repair_parts (shop_id, part_name, supplier_name, supplier_phone, cost) VALUES (?, ?, ?, ?, ?)',
        [shop_id || 1, part_name, supplier_name, supplier_phone, cost || 0], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Part source recorded', part_id: result.insertId });
        });
});

// Consignment / Supplies to Other Shops APIs
app.get('/api/consignments', (req, res) => {
    db.query('SELECT * FROM consignment_items WHERE shop_id = ? ORDER BY consignment_id DESC', [req.query.shop_id || 1], (err, results) => {
        if (err) return res.json([]);
        res.json(results || []);
    });
});

app.post('/api/consignments', (req, res) => {
    const { shop_id, other_shop_name, item_name, imei, wholesale_price } = req.body;
    db.query('INSERT INTO consignment_items (shop_id, other_shop_name, item_name, imei, wholesale_price, status) VALUES (?, ?, ?, ?, ?, "At Other Shop")',
        [shop_id || 1, other_shop_name, item_name, imei || 'N/A', wholesale_price || 0], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Consignment item recorded', consignment_id: result.insertId });
        });
});

app.put('/api/consignments/:id', (req, res) => {
    const { shop_id, status } = req.body;
    db.query('UPDATE consignment_items SET status = ? WHERE consignment_id = ? AND shop_id = ?',
        [status || 'Sold', req.params.id, shop_id || 1], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Consignment status updated' });
        });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));