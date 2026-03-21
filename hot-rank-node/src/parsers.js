const { URL } = require('url');

function parse_mcpmarket(data) {
  const items = data.data || [];
  const result = items.map((item) => ({
    hot_value: Number(item.stars) || 0,
    hot_url: item.url,
    hot_label: item.name,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_douyin_hot(data) {
  let items = data && data.data && data.data.word_list;
  items = items || [];
  const result = items.map((item) => ({
    hot_value: Number(item.hot_value) || 0,
    hot_label: item.word,
    hot_url: `https://www.douyin.com/search/${item.word}`,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_bilibili_hot(data) {
  const items = (data && data.data && data.data.list) || [];
  const w = [0.1, 0.3, 0.5, 0.4, 0.6, 0.4, 0.3];
  const result = items.map((item) => {
    const s = item.stat || {};
    const view = Number(s.view || 0);
    const danmaku = Number(s.danmaku || 0);
    const reply = Number(s.reply || 0);
    const favorite = Number(s.favorite || 0);
    const coin = Number(s.coin || 0);
    const share = Number(s.share || 0);
    const like = Number(s.like || 0);
    const hot =
      view * w[0] +
      danmaku * w[1] +
      reply * w[2] +
      favorite * w[3] +
      coin * w[4] +
      share * w[5] +
      like * w[6];
    return {
      hot_value: Math.floor(hot),
      hot_url: item.short_link_v2,
      hot_label: item.title,
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_juejin_hot(data) {
  let items = data && data.data;
  if (items && items.data) items = items.data;
  items = items || [];
  const result = items.map((item) => ({
    hot_value:
      Number(item.content_counter && item.content_counter.hot_rank) || 0,
    hot_url: `https://juejin.cn/post/${
      item.content && item.content.content_id
    }`,
    hot_label: (item.content && item.content.title) || '',
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_shaoshupai_hot(data) {
  const items = (data && data.data) || [];
  const result = items.map((item) => {
    const comment = Number(item.comment_count || 0);
    const like = Number(item.like_count || 0);
    const hot = comment * 0.6 + like * 0.3;
    return {
      hot_value: Math.floor(hot),
      hot_url: `https://sspai.com/post/${item.id}`,
      hot_label: item.title,
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_tieba_topic(data) {
  let items = data && data.data;
  if (items && items.data) items = items.data;
  if (items && items.bang_topic) items = items.bang_topic.topic_list;
  items = items || [];
  const result = items.map((item) => ({
    hot_value: Number(item.discuss_num || 0),
    hot_url: item.topic_url,
    hot_label: item.topic_name,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_toutiao_hot(data) {
  let items = data && data.data;
  if (items && items.data) items = items.data;
  items = items || [];
  const result = items.map((item) => ({
    hot_value: Number(item.HotValue || 0),
    hot_url: item.Url,
    hot_label: item.Title,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_weibo_hot_search(data) {
  let items = data && data.data;
  if (items && items.data) items = items.data;
  if (items && items.cards) items = items.cards[0] && items.cards[0].card_group;
  items = items || [];
  return items.map((item) => ({
    hot_value: 0,
    hot_url: item.scheme,
    hot_label: item.desc,
  }));
}

function parse_wx_read_rank(data) {
  const books =
    data && data.data && data.data.books ? data.data.books : [];
  const result = books.map((item) => ({
    hot_label: item.bookInfo && item.bookInfo.title,
    hot_value: Number(item.readingCount || 0),
    hot_url: '',
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_zhihu_hot_list(data) {
  let items = data && data.data;
  if (items && items.data) items = items.data;
  items = items || [];
  const result = [];
  for (const item of items) {
    let hotValue = 0;
    try {
      const txt = String(item.detail_text || '').split(' ')[0];
      hotValue = parseFloat(txt) * 10000;
    } catch (e) {
      hotValue = 0;
    }
    if (!item.target || item.target.type !== 'question') continue;
    result.push({
      hot_value: hotValue,
      hot_url: `https://www.zhihu.com/question/${item.target.id}`,
      hot_label: item.target.title,
    });
  }
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_common(data) {
  const items = data && data.data ? data.data : [];
  const result = [];
  let isPercent = false;
  for (const item of items) {
    let hotValue = item.hotScore;
    if (typeof hotValue === 'string') {
      if (hotValue.indexOf('%') >= 0) {
        isPercent = true;
      } else {
        hotValue = parseFloat(
          hotValue.replace('热度', '').replace('万', '0000'),
        );
      }
    }
    if (!isPercent) {
      hotValue = Math.floor(Number(hotValue || 0));
    }
    result.push({
      hot_value: hotValue,
      hot_url: item.url,
      hot_label: item.title,
    });
  }
  if (!isPercent) {
    result.sort((a, b) => b.hot_value - a.hot_value);
  }
  return result;
}

function parse_anquanke(data) {
  const items =
    data && data.data && data.data.list ? data.data.list : [];
  return items.map((item) => ({
    hot_value: 0,
    hot_url: new URL(item.url, 'https://www.anquanke.com').toString(),
    hot_label: item.title,
  }));
}

function parse_acfun(data) {
  const items = data && data.data ? data.data : [];
  return items.map((item) => ({
    hot_value: 0,
    hot_url: item.shareUrl,
    hot_label: item.title,
  }));
}

function parse_csdn(data) {
  const items = data && data.data ? data.data : [];
  const result = items.map((item) => ({
    hot_value: item.hotRankScore,
    hot_url: item.articleDetailUrl,
    hot_label: item.articleTitle,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_douban(data) {
  const items = data && data.data ? data.data : [];
  const koubei = parse_common(items[0] || {});
  const beimei = parse_common(items[1] || {});
  return [koubei, beimei];
}

function parse_openeye(data) {
  const result = [];
  const list =
    data && data.data && data.data.card_list ? data.data.card_list : [];
  for (const item of list) {
    const metros =
      item.card_data &&
      item.card_data.body &&
      item.card_data.body.metro_list
        ? item.card_data.body.metro_list
        : [];
    for (const metro of metros) {
      const title =
        metro.metro_data && metro.metro_data.title
          ? metro.metro_data.title
          : '';
      if (!title) continue;
      const link = metro.link;
      const hotScore =
        metro.metro_data && metro.metro_data.hot_value
          ? metro.metro_data.hot_value
          : 0;
      result.push({
        hot_label: title,
        hot_url: link,
        hot_value: hotScore,
      });
    }
  }
  return result;
}

function parse_pmcaff(data) {
  const items = data && data.data ? data.data : [];
  const result = items.map((res) => ({
    hot_label: res.title,
    hot_url: res.shareUrl,
    hot_value: res.viewNum || 0,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_woshipm(data) {
  const items = data && data.data ? data.data : [];
  const result = items.map((res) => {
    const d = res.data || {};
    return {
      hot_label: d.articleTitle,
      hot_url: `https://www.woshipm.com/${d.type}/${d.id}.html`,
      hot_value: res.scores || 0,
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_xueqiu(data) {
  const items = data && data.items ? data.items : [];
  const result = items.map((i) => {
    const original = i.original_status || {};
    let title = original.description || '';
    title = title.slice(0, 60);
    const link = new URL(original.target, 'https://xueqiu.com').toString();
    return {
      hot_label: title,
      hot_url: link,
      hot_value: 0,
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_yiche(data) {
  const items = data && data.data ? data.data : [];
  const result = items.map((res) => {
    const s = res.shareData || {};
    return {
      hot_label: s.title,
      hot_url: s.link,
      hot_value: 0,
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_youshedubao(data) {
  const list =
    data &&
    data.data &&
    data.data[0] &&
    data.data[0].dubao
      ? data.data[0].dubao
      : [];
  return list.map((news) => ({
    hot_label: news.title,
    hot_url: 'https://www.uisdc.com/news',
    hot_value: 0,
  }));
}

function parse_youxiputao(data) {
  const items =
    data && data.data && data.data.data ? data.data.data : [];
  return items.map((item) => ({
    hot_label: item.title,
    hot_url: `https://youxiputao.com/article/${item.id}`,
    hot_value: 0,
  }));
}

function parse_zhanku(data) {
  const items = data && data.data ? data.data : [];
  return items.map((res) => ({
    hot_label: res.rankingTitle,
    hot_url: res.pageUrl,
    hot_value: res.rankScore,
  }));
}

function parse_zongheng(data) {
  const items =
    data && data.data && data.data.resultList ? data.data.resultList : [];
  return items.map((item) => ({
    hot_label: item.bookName,
    hot_url: `https://www.zongheng.com/detail/${item.bookId}`,
    hot_value: 0,
  }));
}

function parse_tencent_news(data) {
  const items =
    data && data.data && data.data[0] && data.data[0].newslist
      ? data.data[0].newslist
      : [];
  const result = [];
  for (const item of items) {
    if (!item.url) continue;
    const comment = Number(item.commentNum || 0);
    const read = Number(item.readCount || 0);
    const collect = Number(item.collectCount || 0);
    const hot = comment * 0.6 + read * 0.3 + collect * 0.1;
    result.push({
      hot_label: item.title,
      hot_url: item.url,
      hot_value: Math.floor(hot),
    });
  }
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_hupu(data) {
  const items = data && data.data ? data.data : [];
  const result = items.map((item) => ({
    hot_value: item.hotScore,
    hot_url: item.url,
    hot_label: item.title,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_coolan(data) {
  const items = data && data.data ? data.data : [];
  const result = [];
  for (const item of items) {
    const title = item.title;
    if (!title) continue;
    const url = `https://www.coolapk.com${item.turl}`;
    result.push({
      hot_value: item.rank_score,
      hot_url: url,
      hot_label: title,
    });
  }
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_wallstreetcn(data) {
  const items =
    data && data.data && data.data.day_items ? data.data.day_items : [];
  const result = items.map((item) => ({
    hot_label: item.title,
    hot_url: item.uri,
    hot_value: item.pageviews,
  }));
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

function parse_pengpai(data) {
  const items =
    data && data.data && data.data.hotNews ? data.data.hotNews : [];
  return items.map((item) => ({
    hot_label: item.name,
    hot_url: `https://www.thepaper.cn/newsDetail_forward_${item.contId}`,
    hot_value: 0,
  }));
}

function parse_linuxdo(data) {
  const items = data && data.data ? data.data : [];
  const weightPosts = 1.0;
  const weightReplies = 1.5;
  const weightViews = 0.5;
  const weightLikes = 2.0;
  const result = items.map((item) => {
    const posts = Number(item.posts_count || 0);
    const replies = Number(item.reply_count || 0);
    const views = Number(item.views || 0);
    const likes = Number(item.like || 0);
    const score =
      weightPosts * posts +
      weightReplies * replies +
      weightViews * Math.log(views + 1) +
      weightLikes * likes;
    return {
      hot_label: item.title,
      hot_url: `https://linux.do/t/topic/${item.id}`,
      hot_value: Math.floor(score),
    };
  });
  result.sort((a, b) => b.hot_value - a.hot_value);
  return result;
}

module.exports = {
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
};

