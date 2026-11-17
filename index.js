import express from 'express';
import session from 'express-session';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const app = express();
const db = new Database('rental.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    img TEXT,
    rentalPrice REAL NOT NULL,
    address TEXT,
    type TEXT,
    mileage INTEGER,
    rentalCompany TEXT,
    description TEXT,
    fuelConsumption TEXT,
    engineSize TEXT,
    accessories TEXT,
    functionalities TEXT,
    rentalConditions TEXT
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carId INTEGER NOT NULL REFERENCES cars(id),
    userId INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    date TEXT,
    comment TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const adminEmail = 'admin@rentalcar.ua';
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run('Admin', adminEmail, bcrypt.hashSync('admin123', 10), 'admin');
}

// ---------- Початкові автомобілі ----------
const asList = v => JSON.stringify(Array.isArray(v) ? v : v ? [v] : []);

const photo = text => `https://placehold.co/401x268?text=${encodeURIComponent(text)}`;

const baseCond = ['Minimum age: 25', 'Security deposit required', 'Valid driver license'];
const baseAcc = ['Leather seats', 'Panoramic sunroof', 'Premium audio system'];
const baseFunc = ['Power steering', 'Air conditioning', 'Bluetooth connectivity'];

const fallbackCars = [
  ['Buick', 'Enclave', 2008, 40, 'Kiev', 'Luxury Car Rentals', 5858],
  ['Volvo', 'XC90', 2019, 50, 'Lviv', 'Premium Auto Rentals', 5352],
  ['Volvo', 'XC60', 2020, 40, 'Odessa', 'Luxury Car Rentals', 5966],
  ['HUMMER', 'H2', 2006, 50, 'Kharkiv', 'Adventure Car Rentals', 4771],
  ['Subaru', 'Outback', 2016, 30, 'Kyiv', 'Adventure Car Rentals', 4061],
  ['Mitsubishi', 'Outlander', 2010, 30, 'Lviv', 'City Car Rentals', 5374],
  ['Nissan', 'Pathfinder', 2014, 40, 'Odessa', 'Luxury Car Rentals', 6282],
  ['Lincoln', 'Navigator L', 2009, 50, 'Kharkiv', 'Elite Car Rentals', 6173],
  ['GMC', 'Yukon', 2007, 60, 'Kyiv', 'Premium Auto Rentals', 7120],
  ['Hyundai', 'Tucson', 2012, 30, 'Lviv', 'City Car Rentals', 4890],
  ['MINI', 'Cooper', 2011, 40, 'Odessa', 'Adventure Car Rentals', 3560],
  ['Bentley', 'Arnage', 2005, 80, 'Kharkiv', 'Elite Car Rentals', 8210],
].map(([brand, model, year, rentalPrice, city, rentalCompany, mileage]) => ({
  brand,
  model,
  year,
  img: photo(`${brand} ${model}`),
  rentalPrice,
  address: `${10 + (mileage % 80)} Main Street, ${city}, Ukraine`,
  type: 'SUV',
  mileage,
  rentalCompany,
  description: `The ${brand} ${model} (${year}) is a comfortable and reliable car for city trips and long journeys.`,
  fuelConsumption: '10.5',
  engineSize: '3.6L V6',
  accessories: baseAcc,
  functionalities: baseFunc,
  rentalConditions: baseCond,
}));

async function loadCarsFromApi() {
  const list = [];
  let page = 1;
  let totalPages = 1;
  do {
    const resp = await fetch(`https://car-rental-api.goit.global/cars?limit=12&page=${page}`);
    const data = await resp.json();
    list.push(...(Array.isArray(data) ? data : data.cars));
    totalPages = data.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return list;
}

if (db.prepare('SELECT COUNT(*) AS n FROM cars').get().n === 0) {
  let list;
  try {
    list = await loadCarsFromApi();
    console.log('Cars loaded from API');
  } catch (err) {
    console.log('API unavailable, using built-in cars:', err.message);
    list = fallbackCars;
  }

  const insert = db.prepare(`
    INSERT INTO cars (brand, model, year, img, rentalPrice, address, type, mileage,
      rentalCompany, description, fuelConsumption, engineSize,
      accessories, functionalities, rentalConditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(items => {
    for (const c of items) {
      insert.run(
        c.brand, c.model, c.year, c.img, Number(c.rentalPrice), c.address,
        c.type, c.mileage, c.rentalCompany, c.description,
        String(c.fuelConsumption ?? ''), String(c.engineSize ?? ''),
        asList(c.accessories), asList(c.functionalities), asList(c.rentalConditions)
      );
    }
  })(list);

  console.log(`Seeded ${list.length} cars`);
}

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: 'rentalcar-lab-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
  })
);

export const requireAuth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ message: 'Not authorized' });

export const requireAdmin = (req, res, next) =>
  req.session.user?.role === 'admin'
    ? next()
    : res.status(403).json({ message: 'Admin only' });

const emailRe = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || name.trim().length < 2)
    return res.status(400).json({ message: 'Name must be at least 2 characters' });
  if (!emailRe.test(email || ''))
    return res.status(400).json({ message: 'Invalid email' });
  if (!password || password.length < 6)
    return res.status(400).json({ message: 'Password must be at least 6 characters' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
    return res.status(409).json({ message: 'Email already registered' });

  const info = db
    .prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)')
    .run(name.trim(), email, bcrypt.hashSync(password, 10));

  req.session.user = { id: Number(info.lastInsertRowid), name: name.trim(), email, role: 'user' };
  res.status(201).json(req.session.user);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');

  if (!user || !bcrypt.compareSync(password || '', user.password))
    return res.status(401).json({ message: 'Wrong email or password' });

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json(req.session.user);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

app.get('/api/auth/me', (req, res) => {
  req.session.user
    ? res.json(req.session.user)
    : res.status(401).json({ message: 'Not authorized' });
});

const parseList = value => {
  try {
    const r = JSON.parse(value);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
};

const toCar = row => ({
  ...row,
  accessories: parseList(row.accessories),
  functionalities: parseList(row.functionalities),
  rentalConditions: parseList(row.rentalConditions),
});

app.get('/api/cars', (req, res) => {
  const { brand, rentalPrice, minMileage, maxMileage } = req.query;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);

  let where = ' WHERE 1=1';
  const params = [];

  if (brand)       { where += ' AND brand = ?';          params.push(brand); }
  if (rentalPrice) { where += ' AND rentalPrice <= ?';   params.push(Number(rentalPrice)); }
  if (minMileage)  { where += ' AND mileage >= ?';       params.push(Number(minMileage)); }
  if (maxMileage)  { where += ' AND mileage <= ?';       params.push(Number(maxMileage)); }

  const totalCars = db.prepare('SELECT COUNT(*) AS n FROM cars' + where).get(...params).n;
  const rows = db
    .prepare('SELECT * FROM cars' + where + ' ORDER BY id LIMIT ? OFFSET ?')
    .all(...params, limit, (page - 1) * limit);

  res.json({
    cars: rows.map(toCar),
    totalCars,
    page,
    totalPages: Math.max(Math.ceil(totalCars / limit), 1),
  });
});

app.get('/api/cars/:id', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ message: 'Car not found' });
  res.json(toCar(car));
});

app.get('/api/brands', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT brand FROM cars ORDER BY brand').all();
  res.json(rows.map(r => r.brand));
});

app.post('/api/bookings', (req, res) => {
  const { carId, name, email, date, comment } = req.body;

  if (!name || name.trim().length < 2)
    return res.status(400).json({ message: 'Name must be at least 2 characters' });
  if (!emailRe.test(email || ''))
    return res.status(400).json({ message: 'Invalid email' });
  if (date && date < new Date().toISOString().slice(0, 10))
    return res.status(400).json({ message: 'Date cannot be in the past' });
  if (comment && comment.length > 500)
    return res.status(400).json({ message: 'Comment is too long' });
  if (!db.prepare('SELECT id FROM cars WHERE id = ?').get(Number(carId)))
    return res.status(404).json({ message: 'Car not found' });

  const info = db
    .prepare(
      'INSERT INTO bookings (carId, userId, name, email, date, comment) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      Number(carId),
      req.session.user?.id ?? null, 
      name.trim(),
      email,
      date || null,
      comment || null
    );

  res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Booked' });
});

app.get('/api/me/bookings', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.date, b.comment, b.createdAt, c.brand, c.model, c.year, c.img
       FROM bookings b JOIN cars c ON c.id = b.carId
       WHERE b.userId = ? ORDER BY b.id DESC`
    )
    .all(req.session.user.id);
  res.json(rows);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(3000, () => console.log('Server: http://localhost:3000'));