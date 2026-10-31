import { describe, expect, it } from 'vitest';
import {
  htmlHasStructure,
  inlineToHtml,
  looksLikeMarkdown,
  markdownToArticle,
  textStats,
} from './markdown-article';

describe('markdownToArticle', () => {
  it('开头的一级标题当文章标题；## → 标题（h1），### → 副标题（h2），#### → 加粗段落', () => {
    const out = markdownToArticle(
      '# 我的文章\n\n导语\n\n## 第一节\n\n### 小点\n\n#### 更小\n\n# 又一个一级',
    );
    expect(out.title).toBe('我的文章');
    expect(out.html).toBe(
      '<p>导语</p><h1>第一节</h1><h2>小点</h2><p><strong>更小</strong></p><h1>又一个一级</h1>',
    );
  });

  it('嵌套列表拍平', () => {
    expect(markdownToArticle('- 外\n  - 内\n- 外二').html).toBe(
      '<ul><li>外</li><li>内</li><li>外二</li></ul>',
    );
  });

  it('frontmatter 的 title 优先，后面的 # 留在正文', () => {
    const out = markdownToArticle('---\ntitle: "封面标题"\ntags: a\n---\n# 正文标题\n内容');
    expect(out.title).toBe('封面标题');
    expect(out.html).toBe('<h1>正文标题</h1><p>内容</p>');
  });

  it('段落软换行：中文直接接上，英文补空格；行尾两个空格是硬换行', () => {
    expect(markdownToArticle('第一行\n第二行').html).toBe('<p>第一行第二行</p>');
    expect(markdownToArticle('hello\nworld').html).toBe('<p>hello world</p>');
    expect(markdownToArticle('第一行  \n第二行').html).toBe('<p>第一行<br>第二行</p>');
  });

  it('列表、任务列表、有序列表', () => {
    expect(markdownToArticle('- 一\n- [x] 二\n* 三').html).toBe(
      '<ul><li>一</li><li>☑ 二</li><li>三</li></ul>',
    );
    expect(markdownToArticle('1. a\n2. b').html).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('引用按空行分块；代码块变引用并保留缩进、不解析格式', () => {
    expect(markdownToArticle('> 一\n> 二\n>\n> 三').html).toBe(
      '<blockquote>一二</blockquote><blockquote>三</blockquote>',
    );
    expect(markdownToArticle('```js\nif (a) {\n  b(**x**);\n}\n```').html).toBe(
      '<blockquote>if (a) {<br>&nbsp;&nbsp;b(**x**);<br>}</blockquote>',
    );
  });

  it('分隔线、表格、图片', () => {
    expect(markdownToArticle('a\n\n---\n\nb').html).toBe('<p>a</p><p>———</p><p>b</p>');
    expect(markdownToArticle('| 名称 | 价格 |\n| --- | ---: |\n| 苹果 | 3 |').html).toBe(
      '<p><strong>名称 | 价格</strong></p><p>苹果 | 3</p>',
    );
    expect(markdownToArticle('![封面](https://a.com/x.png)').html).toBe(
      '<p><a href="https://a.com/x.png">🖼 封面</a></p>',
    );
  });

  it('文字统计不含标签', () => {
    expect(markdownToArticle('## 标题\n\n**加粗**正文').text).toBe('标题\n加粗正文');
  });
});

describe('行内', () => {
  it('加粗、斜体、删除线、链接、行内代码', () => {
    expect(inlineToHtml('**粗** *斜* ~~删~~ [链接](https://x.com) `a*b*`')).toBe(
      '<strong>粗</strong> <em>斜</em> <s>删</s> <a href="https://x.com">链接</a> a*b*',
    );
  });

  it('snake_case 和单个星号不当斜体；危险链接不出 href；HTML 转义', () => {
    expect(inlineToHtml('my_var_name 2 * 3')).toBe('my_var_name 2 * 3');
    expect(inlineToHtml('[x](javascript:alert(1))')).not.toContain('href');
    expect(inlineToHtml('<script>')).toBe('&lt;script&gt;');
  });
});

describe('判断与统计', () => {
  it('像不像 Markdown', () => {
    expect(looksLikeMarkdown('## 标题\n正文')).toBe(true);
    expect(looksLikeMarkdown('- a\n- b')).toBe(true);
    expect(looksLikeMarkdown('看看 [这个](https://x.com)')).toBe(true);
    expect(looksLikeMarkdown('普通的一句话。')).toBe(false);
    expect(looksLikeMarkdown('第一段\n\n第二段')).toBe(false);
  });

  it('网页复制来的 HTML 有结构就不接管', () => {
    expect(htmlHasStructure('<meta charset="utf-8"><h2>x</h2>')).toBe(true);
    expect(htmlHasStructure('<span style="color:red">x</span>')).toBe(false);
  });

  it('字数与阅读时长', () => {
    expect(textStats('你好世界 hello world')).toEqual({ cjk: 4, words: 2, minutes: 1 });
    expect(textStats('字'.repeat(1200)).minutes).toBe(3);
  });
});
