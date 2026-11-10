const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mobile_shop_db',
    port: process.env.DB_PORT || 3306,
    timezone: '+05:30',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.query((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to MySQL Database.');
    initDatabase();
});

function initDatabase() {
    const createUsers = `
        CREATE TABLE IF NOT EXISTS users (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            shop_id INT DEFAULT 1,
            shop_name VARCHAR(255) DEFAULT 'SHA MOBILE',
            shop_phone VARCHAR(50) DEFAULT 'N/A'
        );
    `;
    const createProducts = `
        CREATE TABLE IF NOT EXISTS products (
            product_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id INT DEFAULT 1,
            product_code VARCHAR(100),
            name TEXT NOT NULL,
            brand VARCHAR(100),
            color VARCHAR(50),
            category VARCHAR(100),
            cost_price DECIMAL(10,2) DEFAULT 0.00,
            selling_price DECIMAL(10,2) DEFAULT 0.00,
            stock INT DEFAULT 1,
            imei VARCHAR(255) DEFAULT 'N/A'
        );
    `;
    const createRepairParts = `
        CREATE TABLE IF NOT EXISTS repair_parts (
            part_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id INT DEFAULT 1,
            part_name VARCHAR(100) NOT NULL,
            device_model VARCHAR(100),
            cost_price DECIMAL(10, 2) DEFAULT 0.00,
            selling_price DECIMAL(10, 2) DEFAULT 0.00,
            stock INT DEFAULT 1
        );
    `;
    const createSales = `
        CREATE TABLE IF NOT EXISTS sales (
            sale_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id INT DEFAULT 1,
            customer_name VARCHAR(255) DEFAULT 'Cash Customer',
            customer_phone VARCHAR(50) DEFAULT 'N/A',
            payment_method VARCHAR(50) DEFAULT 'Cash',
            discount DECIMAL(10,2) DEFAULT 0.00,
            total_amount DECIMAL(10,2) DEFAULT 0.00,
            sale_type VARCHAR(50) DEFAULT 'Product',
            sale_items LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    const createRepairs = `
        CREATE TABLE IF NOT EXISTS repairs (
            repair_id INT AUTO_INCREMENT PRIMARY KEY,
            shop_id INT DEFAULT 1,
            customer_name VARCHAR(255) NOT NULL,
            customer_phone VARCHAR(50) NOT NULL,
            device_model VARCHAR(255) NOT NULL,
            issue_description TEXT NOT NULL,
            advance_cost DECIMAL(10,2) DEFAULT 0.00,
            total_cost DECIMAL(10,2) DEFAULT 0.00,
            status VARCHAR(50) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.query(createUsers, () => {});
    db.query(createProducts, () => {});
    db.query(createRepairParts, () => {});
    db.query(createSales, (err) => {
        if (!err) {
            // Ensure shop_id column exists in sales if table already existed
            db.query("ALTER TABLE sales ADD COLUMN shop_id INT DEFAULT 1", () => {});
        }
    });
    db.query(createRepairs, (err) => {
        if (!err) {
            db.query("ALTER TABLE repairs ADD COLUMN shop_id INT DEFAULT 1", () => {});
        }
    });
}

// ==================== AUTH API ====================
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            const user = results[0];
            if (user.password === password) {
                if (custom_shop_name) {
                    db.query('UPDATE users SET shop_name = ?, shop_phone = ? WHERE user_id = ?', 
                        [custom_shop_name, shop_phone || 'N/A', user.user_id]);
                    user.shop_name = custom_shop_name;
                    user.shop_phone = shop_phone || 'N/A';
                }
                return res.json({ success: true, user: { shop_id: user.shop_id || user.user_id, username: user.username, shop_name: user.shop_name, shop_phone: user.shop_phone } });
            } else {
                return res.status(401).json({ error: 'Incorrect password!' });
            }
        } else {
            const shopName = custom_shop_name || 'SHA MOBILE';
            const phone = shop_phone || 'N/A';
            db.query('INSERT INTO users (username, password, shop_name, shop_phone) VALUES (?, ?, ?, ?)', 
                [username, password, shopName, phone], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                const newId = result.insertId;
                db.query('UPDATE users SET shop_id = ? WHERE user_id = ?', [newId, newId], () => {});
                res.json({ success: true, user: { shop_id: newId, username, shop_name: shopName, shop_phone: phone } });
            });
        }
    });
});

// ==================== PRODUCTS API ====================
app.get('/api/products', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    const sId = shop_id || 1;
    
    db.query(
        'INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sId, 'PRD-000', name, brand || '', color || '', category || 'Brand New Phone', cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const pId = result.insertId;
            const productCode = 'PRD-' + pId.toString().padStart(3, '0');
            db.query('UPDATE products SET product_code = ? WHERE product_id = ?', [productCode, pId], () => {
                res.json({ success: true, product_id: pId, product_code: productCode });
            });
        }
    );
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==================== REPAIR PARTS API ====================
app.get('/api/repair-parts', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT * FROM repair_parts WHERE shop_id = ? ORDER BY part_id DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/repair-parts', (req, res) => {
    const { shop_id, part_name, device_model, compatible_device, cost_price, selling_price, stock } = req.body;
    const sId = shop_id || 1;
    db.query(
        'INSERT INTO repair_parts (shop_id, part_name, device_model, cost_price, selling_price, stock) VALUES (?, ?, ?, ?, ?, ?)',
        [sId, part_name, compatible_device || device_model || '', cost_price || 0, selling_price || 0, stock || 1],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, part_id: result.insertId });
        }
    );
});

app.delete('/api/repair-parts/:id', (req, res) => {
    db.query('DELETE FROM repair_parts WHERE part_id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==================== SALES API (STRICT SHOP ISOLATION & ID FIX) ====================
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id || 1;
    const query = 'SELECT *, sale_id, invoice_id, DATE_FORMAT(created_at, "%Y-%m-%d") as date_only, DATE_FORMAT(created_at, "%Y-%m") as month_only, DATE_FORMAT(created_at, "%Y") as year_only FROM sales WHERE shop_id = ? ORDER BY 1 DESC';
    
    db.query(query, [shopId], (err, results) => {
        if (err) {
            console.error("Sales fetch error:", err);
            return res.json([]);
        }
        processSalesResults(results, res);
    });
});

function processSalesResults(results, res) {
    const formatted = (results || []).map(s => {
        let itemsParsed = [];
        try {
            itemsParsed = typeof s.sale_items === 'string' ? JSON.parse(s.sale_items) : (s.sale_items || s.items || []);
        } catch(e) { itemsParsed = []; }

        const cDate = s.created_at ? new Date(s.created_at) : new Date();

        return {
            ...s,
            sale_id: s.sale_id || s.invoice_id || s.id,
            items: itemsParsed,
            sale_type: s.sale_type || 'Product',
            payment_method: (s.payment_method || 'Cash').trim(),
            discount: parseFloat(s.discount || 0),
            total_amount: parseFloat(s.total_amount || 0),
            formatted_date: cDate.toLocaleString(),
            date_only: s.date_only || cDate.toLocaleDateString('en-CA'),
            month_only: s.month_only || cDate.toLocaleDateString('en-CA').substring(0, 7),
            year_only: s.year_only || cDate.getFullYear().toString()
        };
    });
    res.json(formatted);
}

app.post('/api/sales', (req, res) => {
    const { shop_id, customer_name, customer_phone, payment_method, discount, total_amount, sale_type, items } = req.body;
    const sId = shop_id || 1;
    
    let containsRepair = false, containsProduct = false, containsExchange = false;
    if (items && Array.isArray(items)) {
        items.forEach(item => {
            if (item.type === 'repair') containsRepair = true;
            if (item.type === 'product') containsProduct = true;
            if (item.type === 'exchange') containsExchange = true;
        });
    }
    let resolvedSaleType = sale_type || 'Product';
    if (!sale_type) {
        if (containsExchange) resolvedSaleType = 'Exchange';
        else if (containsRepair && containsProduct) resolvedSaleType = 'Mixed';
        else if (containsRepair) resolvedSaleType = 'Repair';
    }

    db.query(
        'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, discount, total_amount, sale_type, sale_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [sId, customer_name || 'Cash Customer', customer_phone || 'N/A', payment_method || 'Cash', discount || 0, total_amount || 0, resolvedSaleType, JSON.stringify(items || [])],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const saleId = result.insertId;

            if (items && Array.isArray(items)) {
                items.forEach(item => {
                    if (item.type === 'product' && item.product_id) {
                        db.query('UPDATE products SET stock = stock - ? WHERE product_id = ?', [item.qty || 1, item.product_id]);
                    } else if (item.type === 'exchange') {
                        if (item.new_product_id) {
                            db.query('UPDATE products SET stock = stock - ? WHERE product_id = ?', [item.qty || 1, item.new_product_id]);
                        }
                        if (item.returned_product_id) {
                            db.query('UPDATE products SET stock = stock + 1 WHERE product_id = ?', [item.returned_product_id]);
                        }
                    } else if (item.type === 'repair' && item.repair_id) {
                        db.query('UPDATE repairs SET status = "Delivered" WHERE repair_id = ?', [item.repair_id]);
                    }
                });
            }

            res.json({ success: true, sale_id: saleId });
        }
    );
});

app.delete('/api/sales/:id', (req, res) => {
    db.query('DELETE FROM sales WHERE sale_id = ? OR invoice_id = ?', [req.params.id, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==================== REPAIRS API ====================
app.get('/api/repairs', (req, res) => {
    const shopId = req.query.shop_id || 1;
    db.query('SELECT repair_id AS id, repair_id, shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status, created_at FROM repairs WHERE shop_id = ? ORDER BY repair_id DESC', [shopId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    const sId = shop_id || 1;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [sId, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost || 0, 'Pending'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, repair_id: result.insertId });
        }
    );
});

app.put('/api/repairs/:id', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE repairs SET status = ? WHERE repair_id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/repairs/:id', (req, res) => {
    db.query('DELETE FROM repairs WHERE repair_id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==================== MANUAL CLEAR / RESET API ====================
app.post('/api/clear-all', (req, res) => {
    db.query("DELETE FROM sales", () => {});
    db.query("DELETE FROM repairs", () => {});
    db.query("DELETE FROM products", () => {});
    db.query("DELETE FROM repair_parts", () => {});
    res.json({ success: true, message: "All data cleared successfully!" });
});

// ==================== BACKUP & RESTORE API ====================
app.post('/api/restore', (req, res) => {
    const { shop_id, products, sales, repairs, repair_parts } = req.body;
    const sId = shop_id || 1;

    db.query('DELETE FROM products WHERE shop_id = ?', [sId], () => {
        if (products && Array.isArray(products)) {
            products.forEach(p => {
                db.query('INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [sId, p.product_code || 'PRD-000', p.name, p.brand, p.color, p.category, p.cost_price, p.selling_price, p.stock, p.imei], ()=>{});
            });
        }
    });

    db.query('DELETE FROM sales WHERE shop_id = ?', [sId], () => {
        if (sales && Array.isArray(sales)) {
            sales.forEach(s => {
                db.query('INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, sale_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [sId, s.customer_name, s.customer_phone, s.payment_method, s.sale_type || 'Product', s.discount || 0, s.total_amount, JSON.stringify(s.items || s.sale_items || [])], ()=>{});
            });
        }
    });

    db.query('DELETE FROM repairs WHERE shop_id = ?', [sId], () => {
        if (repairs && Array.isArray(repairs)) {
            repairs.forEach(r => {
                db.query('INSERT INTO repairs (repair_id, shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [r.repair_id || r.id, sId, r.customer_name, r.customer_phone, r.device_model, r.issue_description, r.advance_cost || 0, r.total_cost, r.status || 'Pending'], ()=>{});
            });
        }
    });

    db.query('DELETE FROM repair_parts WHERE shop_id = ?', [sId], () => {
        if (repair_parts && Array.isArray(repair_parts)) {
            repair_parts.forEach(rp => {
                db.query('INSERT INTO repair_parts (shop_id, part_name, device_model, cost_price, selling_price, stock) VALUES (?, ?, ?, ?, ?, ?)',
                    [sId, rp.part_name, rp.device_model || '', rp.cost_price || 0, rp.selling_price || 0, rp.stock || 1], ()=>{});
            });
        }
    });

    res.json({ success: true, message: 'Restored successfully' });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port `${PORT}`);
});