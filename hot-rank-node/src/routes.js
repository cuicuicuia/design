const express = require('express');
const { pgPool } = require('./db');
const { redis } = require('./redis');
const { sendEmail } = require('./email');
const {
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  isValidPassword,
  hashPassword,
  verifyPassword,
  newUserUuid,
  signAccessToken,
} = require('./auth');
const { requireAuth, optionalAuth } = require('./authMiddleware');
const { listAiCallLogs, getAiCallStats } = require('./aiCallLog');
const {
  parse_mcpmarket,
  parse_douyin_hot,
  parse_bilibili_hot,
  parse_juejin_hot,
  parse_shaoshupai_hot,
  parse_tieba_topic,
  parse_toutiao_hot,
  parse_weibo_hot_search,
  parse_wx_read_rank,
  parse_zhihu_hot_list,
  parse_common,
  parse_anquanke,
  parse_acfun,
  parse_csdn,
  parse_douban,
  parse_openeye,
  parse_pmcaff,
  parse_woshipm,
  parse_xueqiu,
  parse_yiche,
  parse_youshedubao,
  parse_youxiputao,
  parse_zhanku,
  parse_zongheng,
  parse_tencent_news,
  parse_hupu,
  parse_coolan,
  parse_wallstreetcn,
  parse_pengpai,
  parse_linuxdo,
} = require('./parsers');
const { chatWithModel, chatWithModelStream } = require('./ai');
const workflowApi = require('./workflowPg');

const router = express.Router();

function generateUuid() {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}${random}`;
}

// ---------- Auth ----------
router.post('/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const username = normalizeUsername(req.body && req.body.username);
  const password = req.body && req.body.password;

  if (!isValidEmail(email)) {
    return res.status(400).json({ code: 400, msg: 'invalid email', data: null });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      code: 400,
      msg: 'password must be 8-128 chars',
      data: null,
    });
  }
  if (username && (username.length < 2 || username.length > 32)) {
    return res.status(400).json({
      code: 400,
      msg: 'username must be 2-32 chars',
      data: null,
    });
  }

  const client = await pgPool.connect();
  try {
    const existEmail = await client.query(
      'SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1',
      [email],
    );
    if (existEmail.rows.length > 0) {
      return res.status(409).json({ code: 409, msg: 'email exists', data: null });
    }
    if (username) {
      const existUser = await client.query(
        'SELECT id FROM users WHERE lower(username)=lower($1) LIMIT 1',
        [username],
      );
      if (existUser.rows.length > 0) {
        return res
          .status(409)
          .json({ code: 409, msg: 'username exists', data: null });
      }
    }

    const passwordHash = await hashPassword(password);
    const uuid = newUserUuid();
    const inserted = await client.query(
      `INSERT INTO users (uuid, email, username, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, uuid, email, username, role, status, email_verified, created_at`,
      [uuid, email, username, passwordHash],
    );
    const user = inserted.rows[0];
    const token = signAccessToken({ sub: user.uuid, uid: user.id, role: user.role });
    return res.json({ code: 200, msg: 'success', data: { user, token } });
  } catch (e) {
    console.error('POST /auth/register error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  } finally {
    client.release();
  }
});

router.post('/auth/login', async (req, res) => {
  const accountRaw = req.body && (req.body.email || req.body.username || req.body.account);
  const password = req.body && req.body.password;
  const account = typeof accountRaw === 'string' ? accountRaw.trim() : '';

  if (!account) {
    return res.status(400).json({ code: 400, msg: 'account required', data: null });
  }
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ code: 400, msg: 'password required', data: null });
  }

  const client = await pgPool.connect();
  try {
    const q = await client.query(
      `SELECT id, uuid, email, username, password_hash, role, status, locked_until, failed_login_count
       FROM users
       WHERE lower(email)=lower($1) OR lower(username)=lower($1)
       LIMIT 1`,
      [account],
    );
    if (q.rows.length === 0) {
      return res.status(401).json({ code: 401, msg: 'invalid credentials', data: null });
    }
    const row = q.rows[0];
    if (row.status !== 1) {
      return res.status(403).json({ code: 403, msg: 'user disabled', data: null });
    }
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      return res.status(423).json({ code: 423, msg: 'account locked', data: null });
    }

    const ok = await verifyPassword(password, row.password_hash);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim() || null;
    if (!ok) {
      const nextFailed = Number(row.failed_login_count || 0) + 1;
      let lockedUntil = null;
      if (nextFailed >= 8) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15min
      }
      await client.query(
        'UPDATE users SET failed_login_count=$2, locked_until=$3, updated_at=NOW() WHERE id=$1',
        [row.id, nextFailed, lockedUntil],
      );
      return res.status(401).json({ code: 401, msg: 'invalid credentials', data: null });
    }

    await client.query(
      'UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=NOW(), last_login_ip=$2, updated_at=NOW() WHERE id=$1',
      [row.id, ip],
    );
    const token = signAccessToken({ sub: row.uuid, uid: row.id, role: row.role });
    const user = {
      id: row.id,
      uuid: row.uuid,
      email: row.email,
      username: row.username,
      role: row.role,
      status: row.status,
    };
    return res.json({ code: 200, msg: 'success', data: { user, token } });
  } catch (e) {
    console.error('POST /auth/login error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  } finally {
    client.release();
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) return res.status(401).json({ code: 401, msg: 'Unauthorized', data: null });
  const client = await pgPool.connect();
  try {
    const q = await client.query(
      'SELECT id, uuid, email, username, role, status, email_verified, created_at, last_login_at FROM users WHERE id=$1 LIMIT 1',
      [uid],
    );
    if (q.rows.length === 0) return res.status(404).json({ code: 404, msg: 'not found', data: null });
    return res.json({ code: 200, msg: 'success', data: q.rows[0] });
  } catch (e) {
    console.error('GET /me error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  } finally {
    client.release();
  }
});

// ---------- AI Call Log ----------
router.get('/ai/logs', requireAuth, async (req, res) => {
  const viewerUserId = req.auth && req.auth.uid;
  const role = req.auth && req.auth.role;
  const isAdmin = Number(role || 0) >= 1;
  try {
    const logs = await listAiCallLogs({
      viewerUserId,
      isAdmin,
      limit: req.query && req.query.limit,
      offset: req.query && req.query.offset,
      status: req.query && req.query.status,
      model_name: req.query && (req.query.model_name || req.query.model),
      workflow_id: req.query && req.query.workflow_id,
      from: req.query && req.query.from,
      to: req.query && req.query.to,
    });
    return res.json({ code: 200, msg: 'success', data: logs });
  } catch (e) {
    console.error('GET /ai/logs error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/ai/stats', requireAuth, async (req, res) => {
  const viewerUserId = req.auth && req.auth.uid;
  const role = req.auth && req.auth.role;
  const isAdmin = Number(role || 0) >= 1;
  const from = (req.query && req.query.from) || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const to = (req.query && req.query.to) || new Date().toISOString();
  try {
    const stats = await getAiCallStats({ viewerUserId, isAdmin, from, to });
    return res.json({ code: 200, msg: 'success', data: { from, to, ...stats } });
  } catch (e) {
    console.error('GET /ai/stats error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

// /subscribe
router.post('/subscribe', async (req, res) => {
  const email = req.body && req.body.email;
  if (!email) {
    return res.json({ code: 500, msg: 'email required', data: [] });
  }
  try {
    const exist = await redis.hget('subscriberEmail', email);
    if (exist) {
      return res.json({
        code: 500,
        msg: 'error, maybe the email in my database',
        data: [],
      });
    }
    const uuid = generateUuid();
    await redis.hset('subscriberEmail', email, uuid);
    await sendEmail(
      'Subscribe',
      `Thank you for subscribing to my website. Below is your UUID. To unsubscribe, please enter your UUID (${uuid}) and your email (${email}) in the unsubscribe form on the website and submit it. Love from: https://www.hotday.uk `,
      [email],
    );
    return res.json({
      code: 200,
      msg: 'success',
      data: { uuid, email },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

// /unsubscribe
router.post('/unsubscribe', async (req, res) => {
  const email = req.body && req.body.email;
  const uuid = req.body && req.body.uuid;
  if (!email || !uuid) {
    return res.json({ code: 500, msg: 'email and uuid required', data: [] });
  }
  try {
    const stored = await redis.hget('subscriberEmail', email);
    if (stored) {
      if (stored !== uuid) {
        return res.json({
          code: 500,
          msg: 'error, maybe the uuid is not correct',
          data: [],
        });
      }
      await redis.hdel('subscriberEmail', email);
      await sendEmail(
        'Unsubscribe',
        'Thank you for subscribing to my website. You have successfully unsubscribed from my website. Love from: https://www.hotday.uk ',
        [email],
      );
      return res.json({ code: 200, msg: 'success', data: [] });
    }
    return res.json({
      code: 500,
      msg: 'error, maybe the email not in my database',
      data: [],
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

// /rankCopyWriting
router.get('/rankCopyWriting', async (_req, res) => {
  try {
    const data = await redis.srandmember('copywriting');
    return res.json({ code: 200, msg: 'success', data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.get('/yellowCalendar', async (_req, res) => {
  try {
    const data = await redis.get('yellowCalendar');
    if (!data) {
      return res.json({ code: 500, msg: 'no data', data: null });
    }
    return res.json({ code: 200, msg: 'success', data: JSON.parse(data) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.get('/music', async (_req, res) => {
  try {
    const data = await redis.get('music');
    if (!data) {
      return res.json({ code: 500, msg: 'no data', data: [] });
    }
    return res.json({ code: 200, msg: 'success', data: JSON.parse(data) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/avatar', async (_req, res) => {
  try {
    const data = await redis.srandmember('avatar');
    return res.json({ code: 200, msg: 'success', data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.get('/username', async (_req, res) => {
  try {
    const data = await redis.srandmember('username');
    return res.json({ code: 200, msg: 'success', data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.post('/feedback', async (req, res) => {
  const { subject, content } = req.body || {};
  try {
    await sendEmail(subject, content, ['datehoer@gmail.com']);
    return res.json({ code: 200, msg: 'success' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error' });
  }
});

router.get('/get_cards', async (_req, res) => {
  try {
    const data = await redis.get('card_table');
    if (!data) {
      return res.json({ code: 500, msg: 'no data', data: [] });
    }
    return res.json({ code: 200, msg: 'success', data: JSON.parse(data) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/holiday', async (_req, res) => {
  try {
    const data = await redis.get('holidays');
    if (!data) {
      return res.json({ code: 500, msg: 'no data', data: [] });
    }
    return res.json({ code: 200, msg: 'success', data: JSON.parse(data) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/refresh', async (_req, res) => {
  try {
    const ttl = await redis.ttl('rank');
    const message = {
      code: 200,
      msg: '星链回复是最新数据啦',
      data: [],
    };
    if (ttl && ttl > 0) {
      const now = new Date();
      const totalTtl = 3600;
      const creationTime = new Date(now.getTime() - (totalTtl - ttl) * 1000);
      const nearestHour = new Date(now);
      nearestHour.setMinutes(0, 0, 0);
      if (creationTime < nearestHour) {
        await redis.del('rank');
        await redis.del('todayTopNews');
        message.msg = '已通知星链重新链接中';
      } else {
        const rankData = await redis.get('rank');
        if (rankData) {
          const rankJson = JSON.parse(rankData);
          const timeStatus = rankJson.filter((task) => {
            const t = new Date(
              task.insert_time.replace(' ', 'T') + '.000Z',
            );
            return t < nearestHour;
          });
          if (timeStatus.length > 0) {
            await redis.del('rank');
            await redis.del('todayTopNews');
            message.msg = '已通知星链重新链接中';
          }
        }
      }
    }
    return res.json(message);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

const parserRegistry = {
  zhihu_hot_list: parse_zhihu_hot_list,
  mcpmarket: parse_mcpmarket,
  weibo_hot_search: parse_weibo_hot_search,
  bilibili_hot: parse_bilibili_hot,
  douyin_hot: parse_douyin_hot,
  juejin_hot: parse_juejin_hot,
  shaoshupai_hot: parse_shaoshupai_hot,
  tieba_topic: parse_tieba_topic,
  toutiao_hot: parse_toutiao_hot,
  wx_read_rank: parse_wx_read_rank,
  acfun: parse_acfun,
  anquanke: parse_anquanke,
  csdn: parse_csdn,
  openeye: parse_openeye,
  pmcaff: parse_pmcaff,
  tencent_news: parse_tencent_news,
  woshipm: parse_woshipm,
  xueqiu: parse_xueqiu,
  yiche: parse_yiche,
  youshedubao: parse_youshedubao,
  youxiputao: parse_youxiputao,
  zhanku: parse_zhanku,
  zongheng: parse_zongheng,
  hupu: parse_hupu,
  wallstreetcn: parse_wallstreetcn,
  coolan: parse_coolan,
  pengpai: parse_pengpai,
  linuxdo: parse_linuxdo,
};

async function buildRankData() {
  const data = [];
  try {
    const blog = await redis.get('myblog');
    if (blog) {
      data.push(JSON.parse(blog));
    }
  } catch (e) {
    console.error('Redis get myblog error', e);
  }

  const cardTableRaw = await redis.get('card_table');
  if (!cardTableRaw) {
    throw new Error('card_table not initialized in Redis');
  }
  const tableDict = JSON.parse(cardTableRaw);

  const client = await pgPool.connect();
  try {
    for (const item of tableDict) {
      const collection = item.tablename;
      if (collection === 'myblog') continue;
      try {
        const query = `SELECT * FROM "${collection}" WHERE insert_time IS NOT NULL ORDER BY insert_time DESC LIMIT 1`;
        const result = await client.query(query);
        if (result.rows.length === 0) continue;
        const row = result.rows[0];
        const insertTime = row.insert_time;
        
        // row.data 是 JSONB 字段，在 node-pg 里有时已经是对象，有时还是字符串，这里统一处理
        let rowData = row.data;
        if (typeof rowData === 'string') {
          try {
            rowData = JSON.parse(rowData);
          } catch (err) {
            console.error(`Error parsing JSON for ${collection}`, err);
            continue; // 这条坏数据跳过，不影响其他榜单
          }
        }
        const latestRecord = { data: rowData };
        if (collection === 'douban_movie') {
          const parsed = parse_douban(latestRecord);
          const koubei = parsed[0];
          const beimei = parsed[1];
          const ts = new Date(insertTime * 1000);
          const formatted = ts.toISOString().replace('T', ' ').slice(0, 19);
          data.push({
            name: '豆瓣电影一周口碑榜',
            data: koubei,
            insert_time: formatted,
            id: 998,
          });
          data.push({
            name: '豆瓣电影北美票房榜',
            data: beimei,
            insert_time: formatted,
            id: 999,
          });
          continue;
        }

        const parser = parserRegistry[collection] || parse_common;
        const parsed = parser(latestRecord);
        const ts = new Date(insertTime * 1000);
        const formatted = ts.toISOString().replace('T', ' ').slice(0, 19);
        data.push({
          name: item.name,
          data: parsed,
          insert_time: formatted,
        });
      } catch (e) {
        console.error(`Error parsing ${collection}`, e);
      }
    }
  } finally {
    client.release();
  }
  return data;
}

router.get('/rank/:item_id', async (req, res) => {
  const itemId = req.params.item_id;
  if (itemId !== 'hot') {
    return res.json({ error: 'Invalid value' });
  }
  const cacheKey = 'rank';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ code: 200, msg: 'success', data: JSON.parse(cached) });
    }
  } catch (e) {
    console.error('Redis error', e);
  }

  try {
    const data = await buildRankData();
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify(data));
    } catch (e) {
      console.error('Redis setex error', e);
    }
    return res.json({ code: 200, msg: 'success', data });
  } catch (e) {
    console.error('Postgresql error', e);
    return res
      .status(500)
      .json({ code: 500, msg: 'Internal Server Error', data: [] });
  }
});

// /todayTopNews （AI 部分简化为直接读 Redis 缓存）
router.get('/todayTopNews', async (_req, res) => {
  try {
    const raw = await redis.get('todayTopNews');
    if (raw) {
      return res.json({ code: 200, msg: 'success', data: JSON.parse(raw) });
    }
    // 如果没有缓存，这里不自动触发 AI 生成，保持接口存在且不报错
    return res.json({ code: 200, msg: 'success', data: [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

// 千问 / 通用 AI 聊天：根据当前资讯上下文回答用户问题
const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'string' } },
  required: ['content'],
};
router.post('/chat', optionalAuth, async (req, res) => {
  const { context, message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.json({ code: 400, msg: 'message required', data: null });
  }
  const title = (context && context.title) ? String(context.title).trim() : '';
  const url = (context && context.url) ? String(context.url).trim() : '';
  const system =
    '你是本产品的新闻解读与汇总助手。你已具备联网搜索与网页抓取能力。' +
    '用户会提供一条资讯的标题与链接；请先通过网页抓取访问该链接，获取页面正文与评论区内容（若有），必要时可结合联网搜索补充。' +
    '然后基于所得内容做：1）简要摘要 2）解读 3）回答用户的具体问题。回答简洁、友好，直接给内容即可，无需重复标题或链接。若无法访问该链接，可仅基于联网搜索与标题作答。';
  const user =
    '【当前资讯】\n' +
    (title ? `标题：${title}\n` : '') +
    (url ? `链接：${url}\n` : '') +
    '\n用户问题：' +
    message.trim();
  try {
    const raw = await chatWithModel(
      { system, user },
      CHAT_RESPONSE_SCHEMA,
      {
        logCtx: req.auth ? { user_id: req.auth.uid, workflow_id: null } : null,
        timeoutMs: 20000,
        retries: 2,
      },
    );
    let content = '';
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        content = parsed && typeof parsed.content === 'string' ? parsed.content : raw;
      } catch (_) {
        content = raw;
      }
    }
    return res.json({ code: 200, msg: 'success', data: { content } });
  } catch (e) {
    console.error('POST /chat error', e);
    return res.status(500).json({
      code: 500,
      msg: 'error',
      data: { error: e && e.message ? String(e.message) : 'unknown' },
    });
  }
});

// 流式聊天：返回纯文本流（Transfer-Encoding: chunked），前端用 fetch + response.body.getReader() 读取
router.post('/chat/stream', optionalAuth, async (req, res) => {
  const { context, message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ code: 400, msg: 'message required', data: null });
  }
  const title = (context && context.title) ? String(context.title).trim() : '';
  const url = (context && context.url) ? String(context.url).trim() : '';
  const system =
    '你是本产品的新闻解读与汇总助手。你已具备联网搜索与网页抓取能力。' +
    '用户会提供一条资讯的标题与链接；请先通过网页抓取访问该链接，获取页面正文与评论区内容（若有），必要时可结合联网搜索补充。' +
    '然后基于所得内容做：1）简要摘要 2）解读 3）回答用户的具体问题。回答简洁、友好，直接给内容即可，无需重复标题或链接。若无法访问该链接，可仅基于联网搜索与标题作答。';
  const user =
    '【当前资讯】\n' +
    (title ? `标题：${title}\n` : '') +
    (url ? `链接：${url}\n` : '') +
    '\n用户问题：' +
    message.trim();
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    for await (const item of chatWithModelStream(
      { system, user },
      { logCtx: req.auth ? { user_id: req.auth.uid, workflow_id: null } : null },
    )) {
      const type = item.type === 'reasoning' ? 'r' : 'c';
      res.write(JSON.stringify({ t: type, c: item.chunk }) + '\n');
    }
  } catch (e) {
    console.error('POST /chat/stream error', e);
    res.write(JSON.stringify({ t: 'c', c: '\n[stream error]' }) + '\n');
  }
  res.end();
});

// ---------- 工作流 API ----------
router.get('/workflow/list', requireAuth, async (req, res) => {
  try {
    const orgId = Number(req.auth && req.auth.uid);
    const list = await workflowApi.getList(orgId);
    return res.json({ code: 200, msg: 'success', data: list });
  } catch (e) {
    console.error('GET /workflow/list error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/workflow/public', requireAuth, async (req, res) => {
  try {
    const lim = req.query && req.query.limit;
    const list = await workflowApi.getPublicList(lim);
    return res.json({ code: 200, msg: 'success', data: list });
  } catch (e) {
    console.error('GET /workflow/public error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

// 注意：executions 路由必须在 /workflow/:id 之前，否则会被当成 :id 命中
router.get('/workflow/executions', requireAuth, async (req, res) => {
  const orgId = Number(req.auth && req.auth.uid);
  const workflowId = req.query && req.query.workflowId;
  if (!workflowId) return res.status(400).json({ code: 400, msg: 'workflowId required', data: [] });
  try {
    const list = await workflowApi.listExecutions(String(workflowId), orgId, req.query && req.query.limit);
    return res.json({ code: 200, msg: 'success', data: list });
  } catch (e) {
    console.error('GET /workflow/executions error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: [] });
  }
});

router.get('/workflow/executions/:id', requireAuth, async (req, res) => {
  const orgId = Number(req.auth && req.auth.uid);
  const id = Number(req.params.id);
  try {
    const detail = await workflowApi.getExecution(id, orgId);
    if (!detail) return res.status(404).json({ code: 404, msg: 'not found', data: null });
    return res.json({ code: 200, msg: 'success', data: detail });
  } catch (e) {
    console.error('GET /workflow/executions/:id error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.get('/workflow/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const orgId = Number(req.auth && req.auth.uid);
    const w = await workflowApi.getOne(id, orgId);
    if (!w) return res.status(404).json({ code: 404, msg: 'not found', data: null });
    return res.json({ code: 200, msg: 'success', data: w });
  } catch (e) {
    console.error('GET /workflow/:id error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.post('/workflow', requireAuth, async (req, res) => {
  const body = req.body || {};
  try {
    const orgId = Number(req.auth && req.auth.uid);
    const saved = await workflowApi.saveOne({
      id: body.id,
      name: body.name,
      status: body.status,
      nodes: body.nodes || [],
      edges: body.edges || [],
    }, orgId);
    return res.json({ code: 200, msg: 'success', data: saved });
  } catch (e) {
    console.error('POST /workflow error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: null });
  }
});

router.post('/workflow/run', requireAuth, async (req, res) => {
  const body = req.body || {};
  const orgId = Number(req.auth && req.auth.uid);
  const runtimeInput = body.inputs || body.runtimeInput || {};
  try {
    let workflowId = body.workflowId;
    if (!workflowId) {
      const nodes = body.nodes;
      const edges = body.edges;
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        return res.status(400).json({ code: 400, msg: 'nodes and edges required', data: null });
      }
      const saved = await workflowApi.saveOne(
        { id: undefined, name: body.name || '临时工作流', status: 'draft', nodes, edges },
        orgId,
      );
      workflowId = saved.id;
    }
    const ctx = { user_id: orgId, workflow_id: workflowId };
    const result = await workflowApi.run(workflowId, orgId, runtimeInput, ctx);
    return res.json({ code: 200, msg: 'success', data: result });
  } catch (e) {
    console.error('POST /workflow/run error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: { error: e.message } });
  }
});

router.post('/workflow/run-step', requireAuth, async (req, res) => {
  const body = req.body || {};
  const orgId = Number(req.auth && req.auth.uid);
  const runtimeInput = body.inputs || body.runtimeInput || {};
  const workflowId = body.workflowId;
  const executionId = body.executionId ? Number(body.executionId) : undefined;
  if (!workflowId) return res.status(400).json({ code: 400, msg: 'workflowId required', data: null });
  try {
    const ctx = { user_id: orgId, workflow_id: workflowId };
    const result = await workflowApi.runStep(String(workflowId), orgId, runtimeInput, ctx, executionId);
    return res.json({ code: 200, msg: 'success', data: result });
  } catch (e) {
    console.error('POST /workflow/run-step error', e);
    return res.status(500).json({ code: 500, msg: 'error', data: { error: e.message } });
  }
});

module.exports = { router };

