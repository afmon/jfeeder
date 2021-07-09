const functions = require("firebase-functions");
const admin = require('firebase-admin')
const {Webhook, MessageBuilder } = require("discord-webhook-node");
const Parser = require("rss-parser");

admin.initializeApp(functions.config().firebase);

const RSS_FEED_URLS = [
  'https://gigazine.net/news/rss_2.0/',
  'https://news.yahoo.co.jp/rss/topics/top-picks.xml',
  'http://toushichannel.net/index.rdf',
  'http://blog.livedoor.jp/bluejay01-review/index.rdf',
  'https://pc.watch.impress.co.jp/data/rss/1.0/pcw/feed.rdf',
  'https://internet.watch.impress.co.jp/data/rss/1.0/iw/feed.rdf',
  'https://akiba-pc.watch.impress.co.jp/data/rss/1.0/ah/feed.rdf',
  'https://forest.watch.impress.co.jp/data/rss/1.0/wf/feed.rdf',
  'https://northwood.blog.fc2.com/?xml',
];

exports.jfeeder = functions.region('asia-northeast1').runWith({timeoutSeconds: 15, memory: '128MB'}).pubsub.schedule('* * * * *').timeZone('Asia/Tokyo').onRun((context) => {
  console.log('feed processing begin.');
  // RSS処理
  (async () => {
    const parser = new Parser({timeout: 60000,  customFields: {
        item: [
          ['pubDate', 'date'],['isoDate', 'date'],['dc:date', 'date']
        ]
      }});
    // フィードを1件ずつ非同期で取得してくる
    let feeds = await Promise.all(RSS_FEED_URLS.map((feed_url) => {
      return parser.parseURL(feed_url);
    }));

    // 前回のフィード処理時刻を取得する。
    const documentSnapshot = await admin.firestore().collection('jfeeder').doc('last_update').get().catch((error) => {
      console.log('前回のフィード処理時刻を取得できませんでした。');
      console.log(error);
    });
    const feed_log_raw_data = documentSnapshot.data();

    // 前回のフィード処理時刻より新しいデータのみ処理する。
    let updated_at = typeof feed_log_raw_data === 'undefined' || typeof feed_log_raw_data['updatedAt'] === 'undefined' ? 0 : feed_log_raw_data['updatedAt'].toDate();
    feeds = feeds.reduce((merged_feed, feed, currentIndex) => {
      Array.prototype.push.apply(merged_feed, feed['items'].filter((item, index) => {
        if(updated_at < Date.parse(item['date'])){
          item['site_title'] = feed['title']; // 各フィードアイテムにサイト名称を追加
          return item;
        }
      }));
      return merged_feed;
    }, []);

    // 日時の降順でソート
    feeds.sort((value1, value2) => {
      if(Date.parse(value1['date']) > Date.parse(value2['Date'])){
        return -1;
      }
      return 1;
    });

    // 最終処理日時を保存する
    // set関数でデータの有無にかかわらず上書きを実行する。
    await admin.firestore().collection('jfeeder').doc('last_update').set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch((error) => {
      console.log('フィードの処理時刻を保存できませんでした。');
      console.log(error);
    });

    // 初回処理時の場合は、通知処理をスキップする。
    if( typeof feed_log_raw_data === 'undefined' ){
      // response.send('');
      return;
    }

    const hook = new Webhook("https://discord.com/api/webhooks/769162200551391232/JJtDwULRISRhZhpD3qnRF1WSoPvSG6Pvg14rCRhBmp_gp-UY2d3bEf-xg0wWJSZe3PR9");
    feeds.map((feed, index) => {
      (async () => {
        if(index < 2){
          if(index === 0){
            await hook.send(feeds.length + '件のニュースがあります。');
          }
            await hook.send(new MessageBuilder()
              .setText(feed.title)
              .setTitle(feed.title)
              .setAuthor(feed.creator)
              .setURL(feed.link)
              .setDescription(feed.content.replace(/\r?\n/g,"").replace(/<("[^"]*"|'[^']*'|[^'">])*>/g,''))
              .setFooter(feed.site_title));
        }
      })()
    });

    await admin.firestore().collection('clock').doc('')

    // response.send('');
  })();
  return null;
});
