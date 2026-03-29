import express from "express";
import { createServer as createViteServer } from "vite";
import { startBot, bot } from "./src/bot.ts";
import { getPendingPayment, updatePaymentStatus, updateSubscription, getUser, getAllUsers, getAllPromoCodes, createPromoCode, deletePromoCode, updateVpnConfig, addDaysToUser, getWithdrawals, updateWithdrawalStatus, getUserByEmail, getUserByResetToken, setResetToken, updateUserPassword, createUser, updateUserEmail, setSyncToken, createPendingPayment } from "./src/db.ts";
import { updateClientExpiry, generateVlessConfig, deleteClient } from "./src/vpnService.ts";
import { createYookassaPayment } from "./src/yookassaService.ts";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { config } from "./config.ts";

const JWT_SECRET = config.JWT_SECRET;

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: {
    user: config.SMTP_USER,
    pass: config.SMTP_PASS,
  },
});

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // YooKassa Webhook
  app.post("/api/yookassa/webhook", async (req, res) => {
    const event = req.body;
    console.log('[Yookassa Webhook] Received event:', event.event);

    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      const pending = getPendingPayment(payment.id);

      if (pending && pending.status === 'pending') {
        updatePaymentStatus(payment.id, 'succeeded');
        
        const { telegram_id, plan_id, amount } = pending;
        const SUBSCRIPTION_PLANS = [
          { id: '1', months: 1 },
          { id: '3', months: 3 },
          { id: '6', months: 6 },
          { id: '12', months: 12 },
        ];
        const plan = SUBSCRIPTION_PLANS.find(p => p.id === plan_id);

        if (plan) {
          updateSubscription(telegram_id, plan.months, amount);
          
          // Sync with panel
          const user = getUser(telegram_id);
          if (user && user.vpn_config) {
            const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
            await updateClientExpiry(telegram_id, user.username, expiryTimestamp, user.connection_limit);
          }

          // Notify user
          try {
            await bot.telegram.sendMessage(telegram_id, `✅ *Оплата получена!* Ваша подписка продлена.`, { parse_mode: 'Markdown' });
          } catch (e) {
            console.error('Failed to notify user via bot:', e);
          }
        }
      }
    }
    res.sendStatus(200);
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // User Auth Routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Требуется Email и пароль" });

      const normalizedEmail = email.trim().toLowerCase();
      const user = getUserByEmail(normalizedEmail);
      if (!user || !user.web_password) {
        return res.status(401).json({ error: "Неверный Email или пароль" });
      }

      const isValid = await bcrypt.compare(password, user.web_password);
      if (!isValid) {
        return res.status(401).json({ error: "Неверный Email или пароль" });
      }

      const token = jwt.sign({ telegram_id: user.telegram_id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { telegram_id: user.telegram_id, email: user.email, username: user.username } });
    } catch (e: any) {
      console.error("Login error:", e);
      res.status(500).json({ error: "Ошибка входа: " + e.message });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Требуется Email и пароль" });
      if (password.length < 6) return res.status(400).json({ error: "Пароль должен содержать минимум 6 символов" });

      const normalizedEmail = email.trim().toLowerCase();
      const existingUser = getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ error: "Этот Email уже зарегистрирован. Пожалуйста, войдите в аккаунт или сбросьте пароль." });
      }

      // Generate a fake telegram ID for web-only users
      let fakeTgId;
      let isUnique = false;
      while (!isUnique) {
        fakeTgId = Math.floor(Math.random() * 1000000000) + 9000000000;
        if (!getUser(fakeTgId)) {
          isUnique = true;
        }
      }
      
      // Create user
      createUser(fakeTgId, null, 7, null);
      
      // Set email and password
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      
      updateUserEmail(fakeTgId, normalizedEmail);
      updateUserPassword(fakeTgId, hash);

      const token = jwt.sign({ telegram_id: fakeTgId }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { telegram_id: fakeTgId, email: normalizedEmail, username: null } });
    } catch (e: any) {
      console.error("Registration error:", e);
      res.status(500).json({ error: "Ошибка регистрации: " + e.message });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const normalizedEmail = email.trim().toLowerCase();
    const user = getUserByEmail(normalizedEmail);
    if (!user) {
      // Don't reveal if user exists
      return res.json({ message: "If your email is registered, a recovery link has been sent." });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour
    setResetToken(user.telegram_id, resetToken, expires);

    const appUrl = config.APP_URL;
    const resetLink = `${appUrl}/reset-password?token=${resetToken}`;
    
    try {
      await transporter.sendMail({
        from: config.SMTP_USER,
        to: user.email!,
        subject: "Восстановление пароля DzenVDS",
        text: `Вы запросили восстановление пароля.\n\nПерейдите по ссылке для сброса: ${resetLink}\n\nСсылка действительна 1 час.`,
        html: `<p>Вы запросили восстановление пароля.</p><p><a href="${resetLink}">Нажмите здесь для сброса пароля</a></p><p>Ссылка действительна 1 час.</p>`
      });
      res.json({ message: "If your email is registered, a recovery link has been sent." });
    } catch (e) {
      console.error("Failed to send email:", e);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const user = getUserByResetToken(token);
    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    
    updateUserPassword(user.telegram_id, hash);
    setResetToken(user.telegram_id, null, null); // Clear token
    
    res.json({ message: "Password reset successfully" });
  });

  // User API routes
  const requireUser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { telegram_id: number };
      (req as any).user = getUser(decoded.telegram_id);
      if (!(req as any).user) throw new Error("User not found");
      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  app.get("/api/user/me", requireUser, (req, res) => {
    res.json((req as any).user);
  });

  app.post("/api/user/reset-vpn", requireUser, async (req, res) => {
    const user = (req as any).user;
    try {
      if (user.vpn_config) {
        await deleteClient(user.telegram_id, user.username);
      }
      
      const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
      const config = await generateVlessConfig(user.telegram_id, user.username, expiryTimestamp, user.connection_limit);
      
      if (config) {
        updateVpnConfig(user.telegram_id, config);
        res.json({ success: true, config });
      } else {
        res.status(500).json({ error: "Failed to generate config" });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to reset VPN" });
    }
  });

  app.post("/api/user/sync-telegram", requireUser, async (req, res) => {
    const user = (req as any).user;
    if (user.telegram_id < 9000000000) {
      return res.status(400).json({ error: "Account is already linked to Telegram" });
    }
    const token = crypto.randomBytes(16).toString('hex');
    setSyncToken(user.telegram_id, token);
    const botUsername = config.BOT_USERNAME;
    res.json({ link: `https://t.me/${botUsername}?start=sync_${token}` });
  });

  app.post("/api/user/pay", requireUser, async (req, res) => {
    const user = (req as any).user;
    const { plan_id } = req.body;
    
    const SUBSCRIPTION_PLANS = [
      { id: '1', label: '1 месяц', price: 99 },
      { id: '3', label: '3 месяца', price: 249 },
      { id: '6', label: '6 месяцев', price: 449 },
      { id: '12', label: '12 месяцев', price: 799 },
    ];
    
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === plan_id);
    if (!plan) return res.status(400).json({ error: "Invalid plan" });

    try {
      const payment = await createYookassaPayment(plan.price, `Подписка ДзенVPN: ${plan.label}`, {
        telegram_id: user.telegram_id.toString(),
        plan_id: plan.id.toString()
      });

      createPendingPayment(payment.id, user.telegram_id, plan.id, plan.price);
      res.json({ confirmation_url: payment.confirmation.confirmation_url });
    } catch (e) {
      console.error('Payment creation error:', e);
      res.status(500).json({ error: "Failed to create payment" });
    }
  });

  // Admin API routes
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const pass = req.headers.authorization;
    if (pass === config.ADMIN_PASSWORD) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  app.post("/api/sync", requireAdmin, async (req, res) => {
    try {
      const users = getAllUsers();
      let syncedCount = 0;
      let createdCount = 0;
      let errorCount = 0;

      for (const user of users) {
        if (user.vpn_config) {
          const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
          const success = await updateClientExpiry(user.telegram_id, user.username, expiryTimestamp, user.connection_limit);
          if (success) {
            syncedCount++;
          } else {
            // If it failed, maybe the client was deleted in 3x-ui. Let's try to recreate it.
            const newConfig = await generateVlessConfig(user.telegram_id, user.username, expiryTimestamp, user.connection_limit);
            if (newConfig) {
              updateVpnConfig(user.telegram_id, newConfig);
              createdCount++;
            } else {
              errorCount++;
            }
          }
        }
      }

      res.json({ success: true, syncedCount, createdCount, errorCount });
    } catch (e) {
      console.error('Failed to sync with 3x-ui:', e);
      res.status(500).json({ error: "Failed to sync" });
    }
  });

  app.get("/api/users", requireAdmin, (req, res) => {
    try {
      const users = getAllUsers();
      res.json(users);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/promos", requireAdmin, (req, res) => {
    try {
      const promos = getAllPromoCodes();
      res.json(promos);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch promos" });
    }
  });

  app.post("/api/promos", requireAdmin, (req, res) => {
    try {
      const { code, days, maxUses } = req.body;
      createPromoCode(code, days, maxUses);
      res.json({ success: true });
    } catch (e: any) {
      console.error('Failed to create promo code:', e);
      res.status(500).json({ error: e.message || "Failed to create promo code" });
    }
  });

  app.delete("/api/promos/:code", requireAdmin, (req, res) => {
    try {
      const { code } = req.params;
      deletePromoCode(code);
      res.json({ success: true });
    } catch (e: any) {
      console.error('Failed to delete promo code:', e);
      res.status(500).json({ error: e.message || "Failed to delete promo code" });
    }
  });

  app.get("/api/withdrawals", requireAdmin, (req, res) => {
    try {
      const withdrawals = getWithdrawals();
      res.json(withdrawals);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch withdrawals" });
    }
  });

  app.post("/api/withdrawals/:id/complete", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      updateWithdrawalStatus(parseInt(id), 'completed');
      
      // Notify user
      const withdrawal = getWithdrawals().find(w => w.id === parseInt(id));
      if (withdrawal) {
        try {
          await bot.telegram.sendMessage(withdrawal.user_id, "✅ *Ваша заявка на вывод " + withdrawal.amount + " ₽ выполнена!*\n\nСредства отправлены на ваши реквизиты.", { parse_mode: 'Markdown' });
        } catch (e) {}
      }

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to update withdrawal" });
    }
  });

  app.post("/api/users/:id/send-message", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      await bot.telegram.sendMessage(id, message, { parse_mode: 'Markdown' });
      res.json({ success: true });
    } catch (e) {
      console.error('Failed to send message:', e);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.post("/api/users/bulk/send-message", requireAdmin, async (req, res) => {
    try {
      const { userIds, message } = req.body;
      if (!Array.isArray(userIds) || !message) {
        return res.status(400).json({ error: "userIds array and message are required" });
      }
      let successCount = 0;
      let failCount = 0;
      for (const id of userIds) {
        try {
          await bot.telegram.sendMessage(id, message, { parse_mode: 'Markdown' });
          successCount++;
        } catch (e) {
          console.error("Failed to send message to " + id + ":", e);
          failCount++;
        }
      }
      res.json({ success: true, successCount, failCount });
    } catch (e) {
      console.error('Failed to send bulk message:', e);
      res.status(500).json({ error: "Failed to send bulk message" });
    }
  });

  app.post("/api/users/bulk/add-days", requireAdmin, async (req, res) => {
    try {
      const { userIds, days } = req.body;
      if (!Array.isArray(userIds) || typeof days !== 'number') {
        return res.status(400).json({ error: "userIds array and days number are required" });
      }
      
      let successCount = 0;
      let failCount = 0;
      for (const id of userIds) {
        try {
          const telegramId = parseInt(id);
          addDaysToUser(telegramId, days);
          
          // Update 3x-ui
          const user = getUser(telegramId);
          if (user && user.vpn_config) {
            const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
            await updateClientExpiry(user.telegram_id, user.username, expiryTimestamp, user.connection_limit);
          }
          successCount++;
        } catch (e) {
          console.error("Failed to add days to " + id + ":", e);
          failCount++;
        }
      }
      
      res.json({ success: true, successCount, failCount });
    } catch (e) {
      console.error('Failed to add bulk days:', e);
      res.status(500).json({ error: "Failed to add bulk days" });
    }
  });

  app.post("/api/users/:id/add-days", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { days } = req.body;
      if (typeof days !== 'number') {
        return res.status(400).json({ error: "Days must be a number" });
      }
      
      const telegramId = parseInt(id);
      addDaysToUser(telegramId, days);
      
      // Update 3x-ui
      const user = getUser(telegramId);
      if (user && user.vpn_config) {
        const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
        await updateClientExpiry(user.telegram_id, user.username, expiryTimestamp, user.connection_limit);
      }
      
      res.json({ success: true });
    } catch (e) {
      console.error('Failed to add days:', e);
      res.status(500).json({ error: "Failed to add days" });
    }
  });

  // Start Telegram Bot
  startBot();

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on http://localhost:" + PORT);
  });
}

startServer();
