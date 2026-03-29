import { Telegraf, Markup } from 'telegraf';
import bcrypt from 'bcryptjs';
import { createYookassaPayment, getYookassaPaymentStatus } from './yookassaService.ts';
import { getUser, getUserByEmail, updateUserEmail, updateUserPassword, createUser, updateSubscription, updateVpnConfig, getAllUsers, createPendingPayment, getPendingPayment, updatePaymentStatus, updateExpirationNotification, updateConnectionLimit, addDaysToUser, update3DayNotification, createPromoCode, usePromoCode, getPromoCode, getAllPromoCodes, deletePromoCode, updateZeroTrafficNotification, createWithdrawal, getUserBySyncToken, mergeWebUserToTelegram } from './db.ts';
import { generateVlessConfig, deleteClient, updateClientExpiry, getClientTraffic } from './vpnService.ts';

const BOT_TOKEN = process.env.BOT_TOKEN || '8208808548:AAGYjjNDU79JP-0TRUxv0HuEfKBchlNVAfX';
const ADMIN_IDS = (process.env.ADMIN_IDS || '5446101221').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
const adminStates: Record<number, { mode: string, email?: string }> = {};
export const bot = new Telegraf(BOT_TOKEN);

const MAIN_MENU = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 Получить VPN', 'get_vpn')],
  [Markup.button.callback('👤 Моя подписка', 'my_sub'), Markup.button.callback('📖 Инструкция', 'how_to')],
  [Markup.button.callback('💳 Купить подписку', 'buy_sub')],
  [Markup.button.callback('🎁 Пригласить друга', 'invite_friends')],
  [Markup.button.callback('🌐 Веб-портал', 'web_portal')],
  [Markup.button.url('💬 Поддержка', 'https://t.me/podder5')]
]);

async function sendMainMenu(ctx: any, edit = false) {
  const text = '👋 Добро пожаловать в DzenVDS!\n\nВыберите действие в меню ниже:';
  if (edit) {
    try {
      await ctx.editMessageText(text, MAIN_MENU);
    } catch (e) {
      // Message is not modified or other error
    }
  } else {
    await ctx.reply(text, MAIN_MENU);
  }
}

const YOOKASSA_PROVIDER_TOKEN = process.env.YOOKASSA_PROVIDER_TOKEN || '390540012:LIVE:90657';
const TEST_YOOKASSA_TOKEN = process.env.TEST_YOOKASSA_TOKEN || '381764678:TEST:168868';

const SUBSCRIPTION_PLANS = [
  { id: '1', label: '1 месяц', months: 1, price: 99, description: 'Базовый доступ на 30 дней' },
  { id: '3', label: '3 месяца', months: 3, price: 249, description: 'Экономия 15% - Квартальный доступ' },
  { id: '6', label: '6 месяцев', months: 6, price: 449, description: 'Экономия 25% - Полгода свободы' },
  { id: '12', label: '12 месяцев', months: 12, price: 799, description: 'Экономия 33% - Целый год без границ' },
  { id: 'family', label: 'Семейная (5 чел)', months: 1, price: 300, description: 'Доступ для 5 устройств одновременно' },
];

bot.start(async (ctx) => {
  const tgId = ctx.from.id;
  const username = ctx.from.username || null;
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('sync_')) {
    const token = startPayload.replace('sync_', '');
    const webUser = getUserBySyncToken(token);
    
    if (webUser) {
      const existingUser = getUser(tgId);
      if (existingUser && existingUser.vpn_config) {
        await deleteClient(tgId, existingUser.username);
      }
      
      const success = mergeWebUserToTelegram(webUser.telegram_id, tgId);
      if (success) {
        await ctx.reply('✅ Ваш аккаунт с сайта успешно привязан к Telegram!\nТеперь вы будете получать уведомления здесь, а также можете управлять подпиской.');
      } else {
        await ctx.reply('❌ Произошла ошибка при привязке аккаунта.');
      }
    } else {
      await ctx.reply('❌ Ссылка для привязки недействительна или устарела.');
    }
    // Continue to show main menu
  }

  let user = getUser(tgId);
  if (!user) {
    let initialDays = 7;
    let inviterId: number | null = null;

    if (startPayload && startPayload.startsWith('ref_')) {
      inviterId = parseInt(startPayload.split('_')[1]);
      if (!isNaN(inviterId) && inviterId !== tgId) {
        const inviter = getUser(inviterId);
        if (inviter) {
          initialDays = 14; // 7 standard + 7 bonus
          addDaysToUser(inviterId, 7);
          
          const updatedInviter = getUser(inviterId);
          if (updatedInviter && updatedInviter.vpn_config) {
            const expiryTimestamp = new Date(updatedInviter.subscription_ends_at).getTime();
            await updateClientExpiry(inviterId, updatedInviter.username, expiryTimestamp, updatedInviter.connection_limit);
          }

          try {
            await bot.telegram.sendMessage(inviterId, `🎁 *У вас новый реферал!*\n\nВаша подписка продлена на *+7 дней*. Спасибо за приглашение!`, { parse_mode: 'Markdown' });
          } catch (e) {}
        }
      }
    }

    user = createUser(tgId, username, initialDays, inviterId);
    await ctx.reply(`🎁 Вам начислено *${initialDays} дней* бесплатного пробного периода!${initialDays > 7 ? '\n\n(7 стандартных + 7 бонусных за приглашение)' : ''}`, { parse_mode: 'Markdown' });
  }
  
  await sendMainMenu(ctx, false);
});

bot.command('admin', async (ctx) => {
  const tgId = ctx.from.id;
  console.log(`[ADMIN] Command attempt from ID: ${tgId}. Authorized IDs: ${ADMIN_IDS.join(', ')}`);
  
  if (!ADMIN_IDS.includes(tgId)) {
    console.log(`[ADMIN] Access denied for ID: ${tgId}`);
    return;
  }

  const users = getAllUsers();
  const now = new Date();
  
  let activeSubs = 0;
  let trialUsers = 0;
  let paidUsers = 0;
  let familyUsers = 0;
  let totalRevenue = 0;
  
  users.forEach(u => {
    const endsAt = new Date(u.subscription_ends_at);
    if (endsAt > now) {
      activeSubs++;
      if (!u.total_spent || u.total_spent === 0) {
        trialUsers++;
      } else {
        paidUsers++;
        if (u.connection_limit === 5) familyUsers++;
      }
    }
    totalRevenue += (u.total_spent || 0);
  });

  const statsText = `📊 *Админ-панель ДзенVPN*

👥 Всего пользователей: ${users.length}
✅ Активных всего: ${activeSubs}
🎁 На пробном периоде: ${trialUsers}
💳 Платных подписок: ${paidUsers}
👨‍👩‍👧‍👦 Семейных планов: ${familyUsers}

💰 Общая выручка: ${totalRevenue} ₽`;

  await ctx.reply(statsText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📢 Сделать рассылку', 'admin_broadcast')],
      [Markup.button.callback('🎟 Создать промокод', 'admin_create_promo')],
      [Markup.button.callback('🛠 Управление кодами', 'admin_manage_promos')],
      [Markup.button.callback('📥 Скачать базу (CSV)', 'download_csv')],
      [Markup.button.callback('⬅️ Назад', 'main_menu')]
    ])
  });
});

bot.action('admin_create_promo', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  adminStates[ctx.from.id] = { mode: 'create_promo_step1' };
  await ctx.editMessageText('🎟 *Создание промокода (Шаг 1/3)*\n\nВведите название промокода (например: `DZEN2024`).', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_back')]])
  });
});

bot.action('admin_manage_promos', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  const promos = getAllPromoCodes();
  
  if (promos.length === 0) {
    return ctx.editMessageText('🛠 *Управление промокодами*\n\nУ вас пока нет созданных промокодов.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_back')]])
    });
  }

  let text = '🛠 *Список промокодов:*\n\n';
  const buttons = [];

  promos.forEach(p => {
    text += `🎫 \`${p.code}\` — ${p.days} дн. (${p.current_uses}/${p.max_uses})\n`;
    buttons.push([Markup.button.callback(`❌ Удалить ${p.code}`, `admin_del_promo_${p.code}`)]);
  });

  buttons.push([Markup.button.callback('⬅️ Назад', 'admin_back')]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action(/^admin_del_promo_(.+)$/, async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  const code = ctx.match[1];
  try {
    deletePromoCode(code);
    await ctx.answerCbQuery(`✅ Код ${code} удален`);
  } catch (e: any) {
    console.error('Delete promo error:', e);
    await ctx.answerCbQuery(`❌ Ошибка: ${e.message || 'Не удалось удалить'}`);
  }
  // Refresh the list
  const promos = getAllPromoCodes();
  if (promos.length === 0) {
    return ctx.editMessageText('🛠 *Управление промокодами*\n\nУ вас пока нет созданных промокодов.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_back')]])
    });
  }
  let text = '🛠 *Список промокодов:*\n\n';
  const buttons = [];
  promos.forEach(p => {
    text += `🎫 \`${p.code}\` — ${p.days} дн. (${p.current_uses}/${p.max_uses})\n`;
    buttons.push([Markup.button.callback(`❌ Удалить ${p.code}`, `admin_del_promo_${p.code}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ Назад', 'admin_back')]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('admin_broadcast', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  adminStates[ctx.from.id] = { mode: 'broadcast' };
  await ctx.editMessageText('📢 *Режим рассылки*\n\nВведите текст сообщения, которое вы хотите отправить всем пользователям бота. Вы можете использовать Markdown.\n\n_Чтобы отменить, нажмите кнопку ниже._', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_cancel_broadcast')]])
  });
});

bot.action('admin_cancel_broadcast', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  delete adminStates[ctx.from.id];
  await ctx.editMessageText('❌ Рассылка отменена.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ В админку', 'admin_back')]]));
});

bot.action('admin_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  // Trigger the admin command logic again
  const users = getAllUsers();
  const now = new Date();
  let activeSubs = 0;
  let trialUsers = 0;
  let paidUsers = 0;
  let familyUsers = 0;
  let totalRevenue = 0;
  users.forEach(u => {
    const endsAt = new Date(u.subscription_ends_at);
    if (endsAt > now) {
      activeSubs++;
      if (!u.total_spent || u.total_spent === 0) {
        trialUsers++;
      } else {
        paidUsers++;
        if (u.connection_limit === 5) familyUsers++;
      }
    }
    totalRevenue += (u.total_spent || 0);
  });
  const statsText = `📊 *Админ-панель ДзенVPN*

👥 Всего пользователей: ${users.length}
✅ Активных всего: ${activeSubs}
🎁 На пробном периоде: ${trialUsers}
💳 Платных подписок: ${paidUsers}
👨‍👩‍👧‍👦 Семейных планов: ${familyUsers}

💰 Общая выручка: ${totalRevenue} ₽`;
  await ctx.editMessageText(statsText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📢 Сделать рассылку', 'admin_broadcast')],
      [Markup.button.callback('🎟 Создать промокод', 'admin_create_promo')],
      [Markup.button.callback('🛠 Управление кодами', 'admin_manage_promos')],
      [Markup.button.callback('📥 Скачать базу (CSV)', 'download_csv')],
      [Markup.button.callback('⬅️ Назад', 'main_menu')]
    ])
  });
});

bot.action('download_csv', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return;

  const users = getAllUsers();
  let csv = 'ID;Telegram ID;Username;Trial Started;Subscription Ends;Total Spent (RUB)\n';
  
  users.forEach(u => {
    csv += `${u.id};${u.telegram_id};${u.username || ''};${u.trial_started_at};${u.subscription_ends_at};${u.total_spent || 0}\n`;
  });

  const buffer = Buffer.from(csv, 'utf-8');
  await ctx.replyWithDocument({ source: buffer, filename: 'users_database.csv' });
  await ctx.answerCbQuery();
});

bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendMainMenu(ctx, true);
});

bot.action('my_sub', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = getUser(ctx.from.id);
  if (!user) return;

  const endsAt = new Date(user.subscription_ends_at);
  const now = new Date();
  const isActive = endsAt > now;
  
  const status = isActive ? '✅ Активна' : '❌ Истекла';
  const dateStr = endsAt.toLocaleString('ru-RU');

  const text = `👤 *Моя подписка*\n\nСтатус: ${status}\nДействует до: ${dateStr}\nЛимит устройств: *${user.connection_limit || 1}*`;
  
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'main_menu')]])
  });
});

bot.action('buy_sub', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `💳 *Выберите тарифный план:*

Мы подготовили для вас самые выгодные условия. Чем дольше период, тем дешевле обходится месяц!`;
  
  const buttons = SUBSCRIPTION_PLANS.map(plan => [
    Markup.button.callback(`${plan.label} — ${plan.price} ₽`, `buy_${plan.id}`)
  ]);

  // Add test payment option for admins
  if (ADMIN_IDS.includes(ctx.from.id)) {
    buttons.push([Markup.button.callback('🧪 Тестовая оплата (Admin)', 'buy_test_1')]);
  }

  buttons.push([Markup.button.callback('⬅️ Назад', 'main_menu')]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action(/^buy_(test_)?(.+)$/, async (ctx) => {
  const isTest = ctx.match[1] === 'test_';
  const planId = ctx.match[2];
  const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
  
  if (!plan) return;

  if (isTest) {
    // Keep old test logic for admin testing if needed, or just use real API with test keys
    const token = TEST_YOOKASSA_TOKEN;
    if (!token) {
      await ctx.answerCbQuery('❌ Ошибка: Тестовая система не настроена.', { show_alert: true });
      return;
    }
    await ctx.deleteMessage().catch(() => {});
    await ctx.replyWithInvoice({
      title: `ДзенVPN: ${plan.label} (TEST)`,
      description: plan.description,
      payload: `sub_${plan.id}_${ctx.from.id}`,
      provider_token: token,
      currency: 'RUB',
      prices: [{ label: plan.label, amount: plan.price * 100 }],
      start_parameter: `sub_${plan.id}`,
    });
    return;
  }

  try {
    const payment = await createYookassaPayment(plan.price, `Подписка ДзенVPN: ${plan.label}`, {
      telegram_id: ctx.from.id.toString(),
      plan_id: plan.id.toString()
    });

    createPendingPayment(payment.id, ctx.from.id, plan.id, plan.price);

    await ctx.editMessageText(`💳 *Оплата подписки: ${plan.label}*\n\nСумма к оплате: *${plan.price} ₽*\n\n1. Нажмите кнопку «Перейти к оплате».\n2. Совершите платеж удобным способом (СБП, Карта).\n3. После оплаты вернитесь сюда и нажмите «✅ Я оплатил».\n\n_Подписка продлится автоматически после проверки._`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('💳 Перейти к оплате', payment.confirmation.confirmation_url)],
        [Markup.button.callback('✅ Я оплатил', `check_pay_${payment.id}`)],
        [Markup.button.callback('⬅️ Назад', 'buy_sub')]
      ])
    });
  } catch (error) {
    console.error('Payment Creation Error:', error);
    await ctx.answerCbQuery('❌ Ошибка при создании платежа. Попробуйте позже.', { show_alert: true });
  }
});

bot.action(/^check_pay_(.+)$/, async (ctx) => {
  const paymentId = ctx.match[1];
  const pending = getPendingPayment(paymentId);

  if (!pending) {
    await ctx.answerCbQuery('❌ Платеж не найден.', { show_alert: true });
    return;
  }

  if (pending.status === 'succeeded') {
    await ctx.answerCbQuery('✅ Этот платеж уже зачислен!', { show_alert: true });
    return;
  }

  try {
    const payment = await getYookassaPaymentStatus(paymentId);
    
    if (payment.status === 'succeeded') {
      updatePaymentStatus(paymentId, 'succeeded');
      
      const SUBSCRIPTION_PLANS_INTERNAL = [
        { id: '1', months: 1 },
        { id: '3', months: 3 },
        { id: '6', months: 6 },
        { id: '12', months: 12 },
        { id: 'family', months: 1 },
      ];
      const plan = SUBSCRIPTION_PLANS_INTERNAL.find(p => p.id === pending.plan_id);

      if (plan) {
        updateSubscription(pending.telegram_id, plan.months, pending.amount);
        
        if (pending.plan_id === 'family') {
          updateConnectionLimit(pending.telegram_id, 5);
        } else {
          updateConnectionLimit(pending.telegram_id, 1);
        }

        // Sync with panel
        const user = getUser(pending.telegram_id);
        if (user && user.vpn_config) {
          const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
          await updateClientExpiry(pending.telegram_id, user.username, expiryTimestamp, user.connection_limit);
        }

        await ctx.editMessageText('✅ *Оплата подтверждена!*\n\nВаша подписка успешно продлена. Спасибо, что выбрали ДзенVPN!', { parse_mode: 'Markdown' });
      }
    } else if (payment.status === 'pending' || payment.status === 'waiting_for_capture') {
      await ctx.answerCbQuery('⏳ Оплата еще не поступила. Попробуйте через минуту.', { show_alert: true });
    } else {
      await ctx.answerCbQuery('❌ Платеж отменен или произошла ошибка.', { show_alert: true });
    }
  } catch (error) {
    console.error('Check Payment Error:', error);
    await ctx.answerCbQuery('❌ Ошибка при проверке. Попробуйте позже.', { show_alert: true });
  }
});

// Note: pre_checkout_query and successful_payment are still kept for the TEST invoice flow
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
  const payload = ctx.message.successful_payment.invoice_payload;
  const amount = ctx.message.successful_payment.total_amount / 100;
  const parts = payload.split('_');
  const planId = parts[1];
  const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);

  if (plan) {
    updateSubscription(ctx.from.id, plan.months, amount);
    
    // Sync with panel immediately
    const user = getUser(ctx.from.id);
    if (user && user.vpn_config) {
      const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
      await updateClientExpiry(ctx.from.id, ctx.from.username || null, expiryTimestamp, user.connection_limit);
    }
    
    await ctx.reply(`🎉 *Оплата прошла успешно!*

Ваша подписка продлена на *${plan.label}*. 
Теперь вы можете получить или обновить свой VPN-конфиг в главном меню.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🚀 Начать пользоваться', 'main_menu')]])
    });
  }
});

bot.action('get_vpn', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = getUser(ctx.from.id);
  if (!user) return;

  const endsAt = new Date(user.subscription_ends_at);
  const now = new Date();
  
  if (endsAt <= now) {
    await ctx.editMessageText('❌ Ваша подписка истекла. Пожалуйста, продлите её для получения доступа к VPN.', Markup.inlineKeyboard([
      [Markup.button.callback('💳 Купить подписку', 'buy_sub')],
      [Markup.button.callback('⬅️ Назад', 'main_menu')]
    ]));
    return;
  }

  if (user.vpn_config) {
    await sendVpnConfig(ctx, user.vpn_config);
  } else {
    await ctx.editMessageText('⏳ Генерируем ваш уникальный конфиг...', Markup.inlineKeyboard([]));
    
    try {
      const expiryTimestamp = new Date(user.subscription_ends_at).getTime();
      const config = await generateVlessConfig(ctx.from.id, ctx.from.username || null, expiryTimestamp, user.connection_limit);
      if (config) {
        updateVpnConfig(ctx.from.id, config);
        await sendVpnConfig(ctx, config);
      } else {
        throw new Error('Failed to generate config');
      }
    } catch (error) {
      console.error('VPN Generation Error:', error);
      await ctx.editMessageText(
        '❌ Произошла ошибка при генерации конфига. Пожалуйста, обратитесь в поддержку.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'main_menu')]])
      );
    }
  }
});

bot.action('reset_vpn', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = getUser(ctx.from.id);
  if (!user) return;

  const endsAt = new Date(user.subscription_ends_at);
  const now = new Date();
  
  if (endsAt <= now) {
    await ctx.answerCbQuery('❌ Ваша подписка истекла. Продлите её для сброса конфига.', { show_alert: true });
    return;
  }

  await ctx.editMessageText('⏳ Сбрасываем текущее подключение и генерируем новое...', Markup.inlineKeyboard([]));
  
  try {
    const expiryTimestamp = endsAt.getTime();
    
    // 1. Delete from panel
    await deleteClient(ctx.from.id, ctx.from.username || null);
    
    // 2. Clear in DB
    updateVpnConfig(ctx.from.id, null);
    
    // 3. Generate new
    const config = await generateVlessConfig(ctx.from.id, ctx.from.username || null, expiryTimestamp, user.connection_limit);
    if (config) {
      updateVpnConfig(ctx.from.id, config);
      await sendVpnConfig(ctx, config);
    } else {
      throw new Error('Failed to generate new config');
    }
  } catch (error) {
    console.error('VPN Reset Error:', error);
    await ctx.answerCbQuery('❌ Ошибка при обновлении. Попробуйте позже.', { show_alert: true });
    await sendMainMenu(ctx, false);
  }
});

bot.action('how_to', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `📖 *Как подключить ДзенVPN?*

Настройка займет всего 2 минуты. Выберите ваше устройство для инструкции.

⚠️ *Если VPN не работает:*
Нажмите кнопку *"🔄 Обновить подключение"* в разделе *"🚀 Получить VPN"*. Это сбросит старый ключ и выдаст новый рабочий конфиг.`;
  
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📱 Android', 'how_android'), Markup.button.callback('🍏 iOS (iPhone)', 'how_ios')],
      [Markup.button.callback('💻 Windows', 'how_pc'), Markup.button.callback('🍎 macOS', 'how_mac')],
      [Markup.button.callback('⚠️ Не работает Gemini/ChatGPT', 'how_troubleshoot')],
      [Markup.button.callback('⬅️ Назад', 'main_menu')]
    ])
  });
});

bot.action('how_android', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `🤖 *Инструкция для Android*

1. Скачайте приложение *V2Ray Tun* по кнопке ниже.
2. Скопируйте ваш ключ (VLESS-ссылку) из раздела "🚀 Получить VPN".
3. Откройте приложение и добавьте конфиг через иконку *"+"* или *"Import"*.
4. Нажмите на добавленный профиль и кнопку подключения.
5. При первом запуске разрешите создание VPN-соединения.

✅ *Готово!*`;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([
      [Markup.button.url('📥 Скачать V2Ray Tun (Play Store)', 'https://play.google.com/store/apps/details?id=com.v2raytun.android')],
      [Markup.button.callback('⬅️ Назад', 'how_to')]
    ])
  });
});

bot.action('how_ios', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `🍏 *Инструкция для iOS (iPhone/iPad)*

1. Установите приложение *V2Ray Tun* по кнопке ниже.
2. Скопируйте ваш ключ (VLESS-ссылку).
3. В приложении нажмите *"+"* -> *"Import from Clipboard"*.
4. Выберите добавленный сервер и нажмите кнопку подключения (Connect).
5. Разрешите добавление конфигурации VPN в настройках iPhone.

✅ *Готово!*`;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([
      [Markup.button.url('📥 Скачать V2Ray Tun (App Store)', 'https://apps.apple.com/ru/app/v2raytun/id6476628951')],
      [Markup.button.callback('⬅️ Назад', 'how_to')]
    ])
  });
});

bot.action('how_pc', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `💻 *Инструкция для Windows*

1. Скачайте [v2rayN-With-Core.zip](https://github.com/2dust/v2rayN/releases/download/7.7.1/v2rayN-With-Core.zip) и распакуйте его.
2. Запустите *v2rayN.exe*.
3. Скопируйте ваш ключ (VLESS-ссылку) из бота.
4. В программе нажмите **"Серверы"** -> **"Импорт из буфера обмена"**.
5. **ВАЖНО:** В нижней панели Windows нажмите правой кнопкой на иконку v2rayN -> **"Системный прокси"** -> **"Установить системный прокси"** (иконка станет красной).

✅ *Готово! Теперь весь ваш трафик идет через VPN.*`;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([
      [Markup.button.url('📥 Скачать v2rayN (GitHub)', 'https://github.com/2dust/v2rayN/releases')],
      [Markup.button.callback('⬅️ Назад', 'how_to')]
    ])
  });
});

bot.action('how_mac', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `🍎 *Инструкция для macOS*

1. Установите [FoXray](https://apps.apple.com/us/app/foxray/id6448898396) или [V2RayXS](https://github.com/Cenmrev/V2RayX/releases).
2. Скопируйте ваш ключ (VLESS-ссылку).
3. В приложении нажмите кнопку добавления сервера из буфера обмена.
4. Выберите сервер и нажмите кнопку подключения.

✅ *Готово!*`;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'how_to')]])
  });
});

bot.action('how_troubleshoot', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const text = `⚠️ *Не открывается Gemini, ChatGPT или Netflix?*

Если VPN включен, но эти сайты не работают, проблема обычно в настройках DNS вашего приложения.

*Как исправить:*

1. **В приложении V2Ray Tun (iOS/Android):**
   - Зайдите в «Настройки» -> «DNS».
   - Установите основной DNS: \`1.1.1.1\`
   - Установите альтернативный DNS: \`8.8.8.8\`

2. **В приложении v2rayN (Windows):**
   - Настройки -> Настройки v2ray -> DNS.
   - Убедитесь, что там указаны зарубежные серверы (1.1.1.1).

3. **Очистите кэш браузера:**
   - Иногда браузер «помнит», что вы заходили из России. Попробуйте открыть сайт в режиме инкогнито.

🚀 *После этих настроек Gemini и другие сервисы должны заработать!*`;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'how_to')]])
  });
});

async function sendVpnConfig(ctx: any, config: string) {
  const isMultiple = config.includes('\n');
  const text = `🚀 *Ваши VPN конфигурации (VLESS):*

\`\`\`
${config}
\`\`\`
_(Нажмите на код выше, чтобы скопировать все конфигурации сразу)_

*Краткая инструкция:*
1. Установите приложение для вашего устройства.
2. Скопируйте весь блок текста выше.
3. Откройте приложение и выберите "Импорт из буфера обмена" (Import from Clipboard).
4. У вас появятся ${isMultiple ? 'две конфигурации (основная и резервная)' : 'конфигурация'}.
5. Выберите нужную и нажмите "Подключиться".

💡 *Резервный DzenVDS* используйте, если основной не работает (например, в сетях с белыми списками).

⚠️ *Если VPN не подключается:*
Нажмите кнопку *"🔄 Обновить подключение"* ниже. Это создаст новый профиль в системе.`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить подключение', 'reset_vpn')],
      [Markup.button.callback('📖 Подробная инструкция', 'how_to')],
      [Markup.button.callback('⬅️ Назад', 'main_menu')]
    ])
  });
}

bot.command('market', async (ctx) => {
  const botUsername = ctx.botInfo.username;
  const shareLink = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;
  
  const user = getUser(ctx.from.id);
  const balance = user?.balance || 0;

  const text = `💰 *Заработать вместе с DzenVDS*

Приглашайте друзей и зарабатывайте реальные деньги!

*Условия:*
1. Ваш друг получает **14 дней** (7 стандартных + 7 бонусных) бесплатного VPN.
2. Вы получаете **+7 дней** к своей подписке за каждого друга.
3. 💸 **ГЛАВНОЕ:** Вы получаете **20% от каждой оплаты** вашего друга на свой баланс!

💳 *Ваш баланс:* **${balance.toFixed(2)} ₽**
_(Минимальная сумма для вывода: 500 ₽)_

Ваша персональная ссылка:
\`${shareLink}\`

Отправьте эту ссылку друзьям. Как только они запустят бота, бонусы начислятся автоматически!`;

  const buttons = [
    [Markup.button.url('🚀 Поделиться ссылкой', `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent('Попробуй быстрый и надежный DzenVDS! 14 дней бесплатно по моей ссылке:')}`)],
    [Markup.button.callback('💳 Проверить баланс', 'check_balance')],
    [Markup.button.callback('💸 Вывести средства', 'withdraw_funds')]
  ];

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('invite_friends', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const botUsername = ctx.botInfo.username;
  const shareLink = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;

  const text = `🎁 *Пригласи друга и получи бонусы!*

Подари другу 14 дней бесплатного VPN (вместо 7), а сам получи **+7 дней** к своей подписке за каждого приглашенного!

Ваша персональная ссылка:
\`${shareLink}\`

Отправьте эту ссылку друзьям. Как только они запустят бота, бонусы начислятся автоматически!`;

  const buttons = [
    [Markup.button.url('🚀 Поделиться ссылкой', `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent('Попробуй быстрый и надежный DzenVDS! 14 дней бесплатно по моей ссылке:')}`)],
    [Markup.button.callback('⬅️ Назад', 'main_menu')]
  ];

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('check_balance', async (ctx) => {
  const user = getUser(ctx.from.id);
  const balance = user?.balance || 0;
  await ctx.answerCbQuery(`💳 Ваш баланс: ${balance.toFixed(2)} ₽\nМинимальная сумма для вывода: 500 ₽`, { show_alert: true }).catch(() => {});
});

bot.action('web_portal', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = getUser(ctx.from.id);
  if (!user) return;

  if (!user.email || !user.web_password) {
    const text = `🌐 *Веб-портал DzenVDS*\n\nДля входа на сайт вам нужно задать Email и пароль.\n\nНажмите кнопку ниже, чтобы начать настройку.`;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Настроить доступ', 'setup_web_access')],
        [Markup.button.callback('⬅️ Назад', 'main_menu')]
      ])
    });
  } else {
    const text = `🌐 *Веб-портал DzenVDS*\n\nВаши данные для входа:\n📧 Email: \`${user.email}\`\n\nСайт: [dzenvds.ru](https://dzenvds.ru)`;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Настроить/изменить доступ', 'setup_web_access')],
        [Markup.button.callback('⬅️ Назад', 'main_menu')]
      ])
    });
  }
});

bot.action('setup_web_access', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  adminStates[ctx.from.id] = { mode: 'setup_email' };
  await ctx.editMessageText(`📧 *Настройка доступа*\n\nПожалуйста, отправьте ваш Email ответным сообщением.`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'main_menu')]])
  });
});

bot.action('withdraw_funds', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = getUser(ctx.from.id);
  const balance = user?.balance || 0;

  if (balance < 500) {
    return ctx.answerCbQuery('❌ Минимальная сумма для вывода 500 ₽', { show_alert: true });
  }

  adminStates[ctx.from.id] = { mode: 'withdraw_details' };
  
  await ctx.editMessageText(`💸 *Вывод средств*\n\nВаш баланс: **${balance.toFixed(2)} ₽**\n\nПожалуйста, отправьте ответным сообщением реквизиты для вывода по СБП (номер телефона и название банка).`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'main_menu')]])
  });
});
bot.on('text', async (ctx) => {
  const tgId = ctx.from.id;
  const message = ctx.message as any;
  const text = message.text || '';
  const state = adminStates[tgId];

  console.log(`[MESSAGE] from ${tgId}, text: "${text}", state:`, state);

  if (state) {
    if (state.mode === 'setup_email') {
      const email = text.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return ctx.reply('❌ Неверный формат Email. Пожалуйста, отправьте корректный адрес.');
      }
      const existingUser = getUserByEmail(email);
      if (existingUser && existingUser.telegram_id !== tgId) {
        return ctx.reply('❌ Этот Email уже используется другим аккаунтом. Пожалуйста, укажите другой.');
      }
      state.email = email;
      state.mode = 'setup_password';
      await ctx.reply(`✅ Email принят.\n\nТеперь отправьте пароль для входа на сайт (минимум 6 символов).`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'main_menu')]])
      });
      return;
    } else if (state.mode === 'setup_password') {
      const password = text.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (emailRegex.test(password.toLowerCase())) {
        return ctx.reply('❌ Похоже, вы отправили Email вместо пароля. Пожалуйста, отправьте пароль (минимум 6 символов).');
      }

      if (password.length < 6) {
        return ctx.reply('❌ Пароль должен содержать минимум 6 символов. Попробуйте еще раз.');
      }
      const email = state.email!;
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      
      updateUserEmail(tgId, email);
      updateUserPassword(tgId, hash);
      delete adminStates[tgId];
      
      // Delete the message with the password for security
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (e) {}

      await ctx.reply(`✅ *Доступ настроен!*\n\nВаши данные для входа:\n📧 Email: \`${email}\`\n🔑 Пароль: \`[скрыт в целях безопасности]\`\n\nСайт: [dzenvds.ru](https://dzenvds.ru)`, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ В главное меню', 'main_menu')]])
      });
      return;
    }
  }
  
  // Handle Admin Broadcast
  if (ADMIN_IDS.includes(tgId) && adminStates[tgId]?.mode === 'broadcast') {
    const messageId = message.message_id;
    delete adminStates[tgId];
    
    const users = getAllUsers();
    let successCount = 0;
    let failCount = 0;
    
    console.log(`[ADMIN] Starting broadcast of message ${messageId} to ${users.length} users`);
    await ctx.reply(`🚀 Начинаю рассылку на ${users.length} пользователей...`);
    
    for (const user of users) {
      try {
        await bot.telegram.copyMessage(user.telegram_id, ctx.chat.id, messageId);
        successCount++;
        if (successCount % 50 === 0) console.log(`[ADMIN] Broadcast progress: ${successCount}/${users.length}`);
        // Small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (e: any) {
        failCount++;
        console.error(`Failed to send broadcast to ${user.telegram_id}:`, e.message);
      }
    }
    
    console.log(`[ADMIN] Broadcast finished. Success: ${successCount}, Fail: ${failCount}`);
    
    await ctx.reply(`✅ *Рассылка завершена!*\n\nУспешно: ${successCount}\nОшибок: ${failCount}`, { parse_mode: 'Markdown' });
    return;
  }

  if (message.text) {
    const text = message.text;
    
    // Handle Withdraw Details
    if (adminStates[tgId]?.mode === 'withdraw_details') {
      const details = text;
      const user = getUser(tgId);
      const balance = user?.balance || 0;

      if (balance < 500) {
        delete adminStates[tgId];
        return ctx.reply('❌ Недостаточно средств для вывода.');
      }

      try {
        createWithdrawal(tgId, balance, details);
        delete adminStates[tgId];

        // Notify admins
        for (const adminId of ADMIN_IDS) {
          try {
            await bot.telegram.sendMessage(adminId, `💸 *Новая заявка на вывод!*\n\nПользователь: ${tgId} (@${ctx.from.username || 'нет_юзернейма'})\nСумма: **${balance.toFixed(2)} ₽**\nРеквизиты:\n\`${details}\``, { parse_mode: 'Markdown' });
          } catch (e) {}
        }

        await ctx.reply(`✅ *Заявка на вывод создана!*\n\nСумма: **${balance.toFixed(2)} ₽**\nРеквизиты: ${details}\n\nОжидайте поступления средств.`, { parse_mode: 'Markdown' });
      } catch (e: any) {
        console.error('Withdrawal error:', e);
        delete adminStates[tgId];
        await ctx.reply(`❌ Ошибка при создании заявки: ${e.message || 'Неизвестная ошибка'}`);
      }
      return;
    }

    // Handle Admin Create Promo
    if (ADMIN_IDS.includes(tgId) && adminStates[tgId]?.mode?.startsWith('create_promo_step')) {
      const state = adminStates[tgId];
      if (state.mode === 'create_promo_step1') {
        (state as any).code = text.toUpperCase();
        state.mode = 'create_promo_step2';
        await ctx.reply(`🎟 *Создание промокода: ${(state as any).code} (Шаг 2/3)*\n\nСколько дней подписки будет давать этот код? (Введите число, например: \`30\`)`, { parse_mode: 'Markdown' });
      } else if (state.mode === 'create_promo_step2') {
        const days = parseInt(text);
        if (isNaN(days)) return ctx.reply('❌ Введите число дней.');
        (state as any).days = days;
        state.mode = 'create_promo_step3';
        await ctx.reply(`🎟 *Создание промокода: ${(state as any).code} (Шаг 3/3)*\n\nСколько человек смогут его активировать? (Введите число, например: \`100\`)`, { parse_mode: 'Markdown' });
      } else if (state.mode === 'create_promo_step3') {
        const limit = parseInt(text);
        if (isNaN(limit)) return ctx.reply('❌ Введите число лимита.');
        const { code, days } = state as any;
        try {
          createPromoCode(code, days, limit);
          delete adminStates[tgId];
          await ctx.reply(`✅ *Промокод успешно создан!*\n\nКод: \`${code}\`\nДней: ${days}\nЛимит: ${limit}`, { parse_mode: 'Markdown' });
        } catch (e: any) {
          console.error('Create promo error:', e);
          delete adminStates[tgId];
          await ctx.reply(`❌ Ошибка при создании промокода: ${e.message || 'Неизвестная ошибка'}`);
        }
      }
      return;
    }

    // Handle Promo Code Activation (User sends a message)
    if (!text.startsWith('/')) {
      // Check if the user sent an email address
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const normalizedText = text.trim().toLowerCase();
      if (emailRegex.test(normalizedText)) {
        const email = normalizedText;
        const existingUser = getUserByEmail(email);
        if (existingUser && existingUser.telegram_id !== tgId) {
          return ctx.reply('❌ Этот Email уже используется другим аккаунтом. Пожалуйста, укажите другой.');
        }
        adminStates[tgId] = { mode: 'setup_password', email: email };
        await ctx.reply(`✅ Email принят.\n\nТеперь отправьте пароль для входа на сайт (минимум 6 символов).`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'main_menu')]])
        });
        return;
      }

      console.log(`[PROMO] User ${tgId} attempting to activate code: "${text}"`);
      try {
        const result = usePromoCode(tgId, text);
        
        if (result === true) {
          const promo = getPromoCode(text);
          console.log(`[PROMO] Success! User ${tgId} activated ${text} (+${promo.days} days)`);
          
          const updatedUser = getUser(tgId);
          if (updatedUser && updatedUser.vpn_config) {
            const expiryTimestamp = new Date(updatedUser.subscription_ends_at).getTime();
            await updateClientExpiry(tgId, updatedUser.username, expiryTimestamp, updatedUser.connection_limit);
          }

          await ctx.reply(`✅ *Промокод активирован!*\n\nВам начислено *+${promo.days} дней* подписки. Спасибо!`, { parse_mode: 'Markdown' });
          return;
        } else if (result === 'ALREADY_USED') {
          console.log(`[PROMO] Already used: User ${tgId}, Code ${text}`);
          await ctx.reply('❌ Вы уже активировали этот промокод.');
          return;
        } else if (result === 'EXHAUSTED') {
          console.log(`[PROMO] Exhausted: Code ${text}`);
          await ctx.reply('❌ Лимит использований этого промокода исчерпан.');
          return;
        }
      } catch (e: any) {
        console.error('Promo activation error:', e);
        // Fall through to delete message and show menu
      }
      
      console.log(`[PROMO] Invalid code or regular message from ${tgId}: "${text}"`);
      // If it's not a promo code and not a command, delete and show menu
      try {
        await ctx.deleteMessage().catch(() => {});
        await sendMainMenu(ctx, false);
      } catch (e) {
        console.error('Failed to delete message', e);
      }
    }
  } else {
    // Non-text message from user (not in broadcast mode)
    try {
      await ctx.deleteMessage().catch(() => {});
      await sendMainMenu(ctx, false);
    } catch (e) {}
  }
});

async function checkExpirations() {
  const users = getAllUsers();
  const now = new Date();

  for (const user of users) {
    const endsAt = new Date(user.subscription_ends_at);
    const diffMs = endsAt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // 1. If subscription expired
    if (endsAt < now) {
      const lastNotified = user.last_expiration_notification ? new Date(user.last_expiration_notification) : null;
      if (!lastNotified || lastNotified < endsAt) {
        try {
          await bot.telegram.sendMessage(user.telegram_id, 
            `⚠️ *Ваша подписка истекла!*\n\nДоступ к VPN приостановлен. Чтобы продолжить пользоваться сервисом, пожалуйста, продлите подписку в меню.`, 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('💳 Продлить подписку', 'buy_sub')]]) }
          );
          updateExpirationNotification(user.telegram_id);
        } catch (e) {}
      }
    } 
    // 2. Smart Notification: 3 days left
    else if (diffDays === 3) {
      const last3DayNotified = user.last_3day_notification ? new Date(user.last_3day_notification) : null;
      // Only notify if we haven't notified for THIS 3-day window
      // We check if the last notification was more than 24 hours ago to be safe
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      if (!last3DayNotified || last3DayNotified < oneDayAgo) {
        try {
          const botInfo = await bot.telegram.getMe();
          const shareLink = `https://t.me/${botInfo.username}?start=ref_${user.telegram_id}`;
          const text = `⏳ *Ваша подписка заканчивается через 3 дня!*

Чтобы не потерять доступ к безопасному интернету, вы можете:

1. 💳 *Продлить подписку* в меню бота.
2. 🎁 *Получить дни БЕСПЛАТНО!* Пригласите друга по своей ссылке. Как только он запустит бота, **вы получите +7 дней**, а ваш друг получит **14 дней** (7 стандартных + 7 бонусных) бесплатного периода!

Ваша ссылка для приглашения:
\`${shareLink}\`

Не откладывайте на потом, чтобы оставаться на связи! 🚀`;

          await bot.telegram.sendMessage(user.telegram_id, text, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('💳 Продлить подписку', 'buy_sub')]])
          });
          update3DayNotification(user.telegram_id);
        } catch (e) {}
      }
    }
  }
}

async function checkZeroTraffic() {
  const users = getAllUsers();
  const now = new Date();

  for (const user of users) {
    if (user.zero_traffic_notification_sent === 1) continue;

    const trialStarted = new Date(user.trial_started_at);
    const diffMs = now.getTime() - trialStarted.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Check if 24 hours have passed since they got the key
    if (diffHours >= 24) {
      const traffic = await getClientTraffic(user.telegram_id, user.username);
      
      if (traffic) {
        const totalTraffic = traffic.up + traffic.down;
        
        if (totalTraffic === 0) {
          // Send help message
          try {
            const text = `👋 *Привет!*\n\nЯ заметил, что ты получил ключ для VPN, но еще ни разу не подключился.\n\nВозникли сложности с настройкой? Не переживай, это бывает! Вот подробные инструкции для твоего устройства:\n\n📱 *iOS (iPhone/iPad):*\n1. Скачай приложение V2Ray Tun из AppStore.\n2. Скопируй свой ключ из бота.\n3. Открой приложение, нажми "+" и выбери "Import from Clipboard".\n\n🤖 *Android:*\n1. Скачай приложение V2Ray Tun из Google Play.\n2. Скопируй свой ключ из бота.\n3. Открой приложение, нажми "+" и выбери "Импорт профиля из буфера обмена".\n\n💻 *Windows/Mac:*\nИспользуй приложение v2rayN или Nekoray.\n\nЕсли нужна помощь, просто напиши администратору!`;
            
            await bot.telegram.sendMessage(user.telegram_id, text, { 
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([[Markup.button.callback('🔑 Мой ключ', 'my_key')]])
            });
          } catch (e) {
            console.error(`Failed to send zero traffic notification to ${user.telegram_id}`, e);
          }
        }
        
        // Mark as sent (or checked) so we don't bother them again
        updateZeroTrafficNotification(user.telegram_id);
      }
    }
  }
}

export function startBot() {
  bot.launch().then(() => {
    console.log('Bot started');
    // Start expiration checker every hour
    setInterval(checkExpirations, 60 * 60 * 1000);
    // Start zero traffic checker every hour
    setInterval(checkZeroTraffic, 60 * 60 * 1000);
    // Initial checks on start
    checkExpirations();
    checkZeroTraffic();
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
