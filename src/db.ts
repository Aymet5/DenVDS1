import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Создаем папку data, если ее нет, чтобы база данных не удалялась при обновлении файлов
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const oldDbPath = path.resolve(process.cwd(), 'vpn_bot.db');
const newDbPath = path.resolve(dataDir, 'vpn_bot.db');

// Автоматический перенос старой базы данных в новую папку, если она осталась в корне
if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
  console.log('🔄 Перенос старой базы данных в папку data/ ...');
  fs.renameSync(oldDbPath, newDbPath);
}

// По умолчанию используем папку data
const dbPath = newDbPath;
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    trial_started_at DATETIME,
    subscription_ends_at DATETIME,
    vpn_config TEXT,
    total_spent INTEGER DEFAULT 0,
    last_expiration_notification TEXT,
    last_3day_notification TEXT,
    connection_limit INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    days INTEGER NOT NULL,
    max_uses INTEGER NOT NULL,
    current_uses INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS used_promos (
    user_id INTEGER,
    promo_code TEXT,
    PRIMARY KEY (user_id, promo_code)
  );

  CREATE TABLE IF NOT EXISTS pending_payments (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER,
    plan_id TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT
  );
`);

// Migrations for existing databases
try {
  db.exec("ALTER TABLE users ADD COLUMN last_expiration_notification TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN connection_limit INTEGER DEFAULT 3");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN total_spent INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN vpn_config TEXT");
} catch (e) {}

// Update existing users who have connection_limit = 1 to 3
try {
  db.exec("UPDATE users SET connection_limit = 3 WHERE connection_limit = 1");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN last_3day_notification TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN zero_traffic_notification_sent INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN inviter_id INTEGER");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN balance REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
} catch (e) {}

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN web_password TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN reset_token_expires DATETIME");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN telegram_sync_token TEXT");
} catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    details TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (telegram_id)
  )
`);

export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  trial_started_at: string;
  subscription_ends_at: string;
  vpn_config: string | null;
  total_spent: number;
  last_expiration_notification: string | null;
  last_3day_notification: string | null;
  connection_limit: number;
  zero_traffic_notification_sent: number;
  inviter_id?: number | null;
  balance: number;
  email?: string | null;
  web_password?: string | null;
  reset_token?: string | null;
  reset_token_expires?: string | null;
  telegram_sync_token?: string | null;
}

export function getUser(telegramId: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
}

export function getUserByResetToken(token: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token) as User | undefined;
}

export function getUserBySyncToken(token: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE telegram_sync_token = ?').get(token) as User | undefined;
}

export function setSyncToken(telegramId: number, token: string | null) {
  db.prepare('UPDATE users SET telegram_sync_token = ? WHERE telegram_id = ?').run(token, telegramId);
}

export function mergeWebUserToTelegram(fakeTgId: number, realTgId: number): boolean {
  const fakeUser = getUser(fakeTgId);
  if (!fakeUser) return false;

  const realUser = getUser(realTgId);

  const transaction = db.transaction(() => {
    if (realUser) {
      // Merge subscriptions: take the furthest date
      const fakeExpiry = new Date(fakeUser.subscription_ends_at);
      const realExpiry = new Date(realUser.subscription_ends_at);
      const furthestExpiry = fakeExpiry > realExpiry ? fakeExpiry : realExpiry;
      
      // Merge connection limits: take the highest
      const maxLimit = Math.max(fakeUser.connection_limit, realUser.connection_limit);
      
      // Merge balance
      const totalBalance = (fakeUser.balance || 0) + (realUser.balance || 0);

      // Update the fake user record with merged data and the real telegram_id
      db.prepare(`
        UPDATE users 
        SET telegram_id = ?, 
            telegram_sync_token = NULL,
            subscription_ends_at = ?,
            connection_limit = ?,
            balance = ?
        WHERE telegram_id = ?
      `).run(realTgId, furthestExpiry.toISOString(), maxLimit, totalBalance, fakeTgId);

      // Delete the old real user record
      db.prepare('DELETE FROM users WHERE telegram_id = ?').run(realTgId);
    } else {
      // Just update the fake user's ID to the real one
      db.prepare('UPDATE users SET telegram_id = ?, telegram_sync_token = NULL WHERE telegram_id = ?').run(realTgId, fakeTgId);
    }
  });

  try {
    transaction();
    return true;
  } catch (e) {
    console.error('[DB] Error merging users:', e);
    return false;
  }
}

export function updateUserEmail(telegramId: number, email: string) {
  db.prepare('UPDATE users SET email = ? WHERE telegram_id = ?').run(email, telegramId);
}

export function updateUserPassword(telegramId: number, passwordHash: string) {
  db.prepare('UPDATE users SET web_password = ? WHERE telegram_id = ?').run(passwordHash, telegramId);
}

export function setResetToken(telegramId: number, token: string | null, expires: string | null) {
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE telegram_id = ?').run(token, expires, telegramId);
}

export function createUser(telegramId: number, username: string | null, initialDays: number = 7, inviterId: number | null = null): User {
  const now = new Date();
  const trialEnds = new Date(now.getTime() + initialDays * 24 * 60 * 60 * 1000);
  
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, username, trial_started_at, subscription_ends_at, connection_limit, inviter_id)
    VALUES (?, ?, ?, ?, 3, ?)
  `);
  
  stmt.run(telegramId, username, now.toISOString(), trialEnds.toISOString(), inviterId);
  return getUser(telegramId)!;
}

export function addDaysToUser(telegramId: number, days: number) {
  const user = getUser(telegramId);
  if (!user) return;

  const now = new Date();
  const currentEnds = new Date(user.subscription_ends_at);
  const baseDate = currentEnds > now ? currentEnds : now;
  
  baseDate.setDate(baseDate.getDate() + Number(days));
  
  db.prepare('UPDATE users SET subscription_ends_at = ? WHERE telegram_id = ?')
    .run(baseDate.toISOString(), telegramId);
}

export function addBalance(telegramId: number, amount: number) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, telegramId);
}

export function deductBalance(telegramId: number, amount: number) {
  db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?').run(amount, telegramId);
}

export function createWithdrawal(userId: number, amount: number, details: string) {
  db.prepare('INSERT INTO withdrawals (user_id, amount, details, created_at) VALUES (?, ?, ?, ?)').run(userId, amount, details, new Date().toISOString());
  deductBalance(userId, amount);
}

export function getWithdrawals() {
  return db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC').all() as any[];
}

export function updateWithdrawalStatus(id: number, status: string) {
  db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run(status, id);
}

export function updateSubscription(telegramId: number, monthsToAdd: number, amountPaid: number) {
  const user = getUser(telegramId);
  if (!user) return;

  const now = new Date();
  const currentEnds = new Date(user.subscription_ends_at);
  const baseDate = currentEnds > now ? currentEnds : now;
  
  baseDate.setMonth(baseDate.getMonth() + Number(monthsToAdd));
  
  db.prepare('UPDATE users SET subscription_ends_at = ?, total_spent = COALESCE(total_spent, 0) + ? WHERE telegram_id = ?')
    .run(baseDate.toISOString(), amountPaid, telegramId);

  // Add 20% to inviter's balance
  if (user.inviter_id && amountPaid > 0) {
    const bonus = amountPaid * 0.20;
    addBalance(user.inviter_id, bonus);
  }
}

export function createPendingPayment(id: string, telegramId: number, planId: string, amount: number) {
  db.prepare('INSERT INTO pending_payments (id, telegram_id, plan_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, telegramId, planId, amount, new Date().toISOString());
}

export function getPendingPayment(id: string) {
  return db.prepare('SELECT * FROM pending_payments WHERE id = ?').get(id) as any;
}

export function updatePaymentStatus(id: string, status: string) {
  db.prepare('UPDATE pending_payments SET status = ? WHERE id = ?').run(status, id);
}

export function updateVpnConfig(telegramId: number, config: string | null) {
  db.prepare('UPDATE users SET vpn_config = ? WHERE telegram_id = ?')
    .run(config, telegramId);
}

export function updateExpirationNotification(telegramId: number) {
  db.prepare('UPDATE users SET last_expiration_notification = ? WHERE telegram_id = ?')
    .run(new Date().toISOString(), telegramId);
}

export function update3DayNotification(telegramId: number) {
  db.prepare('UPDATE users SET last_3day_notification = ? WHERE telegram_id = ?')
    .run(new Date().toISOString(), telegramId);
}

export function updateConnectionLimit(telegramId: number, limit: number) {
  db.prepare('UPDATE users SET connection_limit = ? WHERE telegram_id = ?')
    .run(limit, telegramId);
}

export function updateZeroTrafficNotification(telegramId: number) {
  db.prepare('UPDATE users SET zero_traffic_notification_sent = 1 WHERE telegram_id = ?')
    .run(telegramId);
}

export function getAllUsers(): User[] {
  return db.prepare('SELECT * FROM users').all() as User[];
}

// Promo Code Functions
export function createPromoCode(code: string, days: number, maxUses: number) {
  // Use INSERT OR REPLACE to allow updating existing promo codes
  db.prepare('INSERT OR REPLACE INTO promo_codes (code, days, max_uses, current_uses) VALUES (?, ?, ?, COALESCE((SELECT current_uses FROM promo_codes WHERE code = ?), 0))')
    .run(code.toUpperCase(), days, maxUses, code.toUpperCase());
}

export function getPromoCode(code: string) {
  const trimmedCode = code.trim().toUpperCase();
  return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(trimmedCode) as any;
}

export function usePromoCode(telegramId: number, code: string) {
  const trimmedCode = code.trim().toUpperCase();
  const promo = getPromoCode(trimmedCode);
  if (!promo) return false;

  // Check if user already used it
  const alreadyUsed = db.prepare('SELECT * FROM used_promos WHERE user_id = ? AND promo_code = ?')
    .get(telegramId, promo.code);
  
  if (alreadyUsed) return 'ALREADY_USED';
  if (promo.current_uses >= promo.max_uses) return 'EXHAUSTED';

  // Apply days
  addDaysToUser(telegramId, promo.days);

  // Mark as used
  db.prepare('INSERT INTO used_promos (user_id, promo_code) VALUES (?, ?)').run(telegramId, promo.code);
  db.prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE code = ?').run(promo.code);

  return true;
}

export function getAllPromoCodes() {
  return db.prepare('SELECT * FROM promo_codes').all() as any[];
}

export function deletePromoCode(code: string) {
  db.prepare('DELETE FROM promo_codes WHERE code = ?').run(code.toUpperCase());
  db.prepare('DELETE FROM used_promos WHERE promo_code = ?').run(code.toUpperCase());
}
