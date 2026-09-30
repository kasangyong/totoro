// 데모 파일(../*-demo.html)을 사이트 페이지로 바꿔서 이 폴더에 씀
//   node site/build.js
// - 완전한 HTML 문서로 감싸고 공통 theme.css를 불러옴
// - 글꼴을 사이트 글꼴로 바꿈
// - 지갑을 사이트 공통 키(bhmh.bal) 하나로 합침
// - 머리글에 로비로 돌아가는 링크를 넣음
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const PAGES = [
  { src: 'crash-demo.html', out: 'crash.html', title: 'Crash', key: 'crash' },
  { src: 'mines-demo.html', out: 'mines.html', title: 'Mines', key: 'mines' },
  { src: 'plinko-demo.html', out: 'plinko.html', title: 'Plinko', key: 'plinko' },
  { src: 'chicken-demo.html', out: 'chicken.html', title: '치킨 크로싱', key: 'chicken' },
  { src: 'hilo-demo.html', out: 'hilo.html', title: 'HiLo', key: 'hilo' },
  { src: 'quick-games-demo.html', out: 'quick.html', title: 'Dice · Limbo · Wheel', key: 'quick' },
];
const FONT_OLD = 'family=Chakra+Petch:wght@500;700&family=IBM+Plex+Sans+KR:wght@400;500;700';
const FONT_NEW = 'family=Oswald:wght@500;600;700&family=Black+Han+Sans&family=IBM+Plex+Sans+KR:wght@400;500;700';

function replaceOnce(s, a, b, file) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`${file}: "${a.slice(0, 50)}" 가 ${n}번 나옴`);
  return s.replace(a, () => b);
}

for (const p of PAGES) {
  let s = fs.readFileSync(path.join(SRC, p.src), 'utf8');
  s = s.replace(/<title>[^<]*<\/title>/, `<title>${p.title} · 배팅 할래 말래</title>`);
  s = replaceOnce(s, FONT_OLD, FONT_NEW, p.src);
  s = s.split('"Chakra Petch"').join('"Oswald"');
  // 지갑 합치기
  s = s.split(`'${p.key}.bal'`).join("'bhmh.bal'");
  if (s.includes(`'${p.key}.bal'`)) throw new Error(p.src + ': 지갑 키가 남음');
  // 머리글: 로비 링크 + 사이트 이름
  s = replaceOnce(s, '<header class="top">\n    <div class="brand">',
    '<header class="top">\n    <a class="back" href="index.html">‹ 로비</a>\n    <div class="brand">', p.src);
  s = s.split('<span>가상 포인트 데모</span>').join('<span>배팅 할래 말래</span>');
  // 문서로 감싸기: </style> 뒤에 theme.css, 그다음부터 본문
  const cut = s.indexOf('</style>') + '</style>'.length;
  const head = s.slice(0, cut), body = s.slice(cut);
  s = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
<link rel="stylesheet" href="theme.css">
</head>
<body>${body}
<script>
  // 뒤로 가기로 돌아왔을 때 다른 게임에서 바뀐 지갑을 다시 읽음
  addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(__dirname, p.out), s);
  console.log('built', p.out);
}
