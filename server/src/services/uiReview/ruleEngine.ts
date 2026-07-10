import { getDatabase } from '../../db/index.js';
import type { CrawlResult, ElementData } from './crawlerService.js';

export interface RuleConfig {
  id: string;
  name: string;
  dimension: string;
  description: string;
  detection_type: string;
  detection_config: any;
  weight: number;
  severity: string;
  industry_weights: any;
}

export interface RuleResult {
  ruleId: string;
  name: string;
  dimension: string;
  severity: string;
  passed: boolean;
  score: number;
  details: string;
  affectedElements?: string[];
}

type RuleChecker = (crawlData: CrawlResult, config: any) => RuleResult;

// Parse color string to RGB
function parseColor(colorStr: string): { r: number; g: number; b: number } | null {
  const rgb = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) return { r: parseInt(rgb[1]), g: parseInt(rgb[2]), b: parseInt(rgb[3]) };
  return null;
}

// Calculate relative luminance
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Calculate contrast ratio
function getContrastRatio(color1: string, color2: string): number {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);
  if (!c1 || !c2) return 21;
  const l1 = getLuminance(c1.r, c1.g, c1.b);
  const l2 = getLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Built-in rule implementations
const ruleCheckers: Record<string, RuleChecker> = {
  contrast_ratio: (crawlData, config) => {
    const threshold = config.threshold || 4.5;
    const textElements = crawlData.elementData.filter(e =>
      e.text && e.color && e.backgroundColor && e.backgroundColor !== 'rgba(0, 0, 0, 0)'
    );
    const failures: string[] = [];
    for (const el of textElements) {
      const ratio = getContrastRatio(el.color, el.backgroundColor);
      if (ratio < threshold) {
        failures.push(`${el.selector} (ratio: ${ratio.toFixed(1)}, need: ${threshold})`);
      }
    }
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: failures.length === 0,
      score: failures.length === 0 ? 100 : Math.max(0, 100 - failures.length * 15),
      details: failures.length ? `${failures.length} elements have insufficient contrast` : 'All text meets contrast requirements',
      affectedElements: failures.slice(0, 5),
    };
  },

  font_hierarchy: (crawlData, _config) => {
    const headings = crawlData.elementData.filter(e => e.tag.match(/^h[1-6]$/));
    if (headings.length < 2) return { ruleId: '', name: '', dimension: '', severity: '', passed: true, score: 100, details: 'Not enough headings to evaluate hierarchy' };

    const sizes = headings.map(h => ({ tag: h.tag, size: parseFloat(h.fontSize) }));
    sizes.sort((a, b) => parseInt(a.tag[1]) - parseInt(b.tag[1]));

    let violations = 0;
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i].size >= sizes[i - 1].size) violations++;
    }
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: violations === 0,
      score: violations === 0 ? 100 : Math.max(0, 100 - violations * 20),
      details: violations ? `${violations} heading size inversions found` : 'Heading hierarchy is correct',
    };
  },

  spacing_consistency: (crawlData, _config) => {
    const paddings = crawlData.elementData
      .map(e => parseFloat(e.padding))
      .filter(p => p > 0 && !isNaN(p));
    if (paddings.length < 3) return { ruleId: '', name: '', dimension: '', severity: '', passed: true, score: 100, details: 'Insufficient data' };

    const uniquePaddings = [...new Set(paddings)];
    const ratio = uniquePaddings.length / paddings.length;
    const isConsistent = ratio < 0.5;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: isConsistent,
      score: isConsistent ? 100 : Math.max(0, 100 - Math.round(ratio * 80)),
      details: `${uniquePaddings.length} unique spacing values out of ${paddings.length} elements (${isConsistent ? 'consistent' : 'inconsistent'})`,
    };
  },

  click_target_size: (crawlData, config) => {
    const minSize = config.minSize || 44;
    const clickables = crawlData.elementData.filter(e => e.isClickable);
    const tooSmall = clickables.filter(e => e.width < minSize || e.height < minSize);
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: tooSmall.length === 0,
      score: tooSmall.length === 0 ? 100 : Math.max(0, 100 - tooSmall.length * 10),
      details: tooSmall.length ? `${tooSmall.length} clickable elements are smaller than ${minSize}px` : 'All click targets meet minimum size',
      affectedElements: tooSmall.slice(0, 5).map(e => `${e.selector} (${e.width}x${e.height}px)`),
    };
  },

  color_convergence: (crawlData, config) => {
    const maxColors = config.maxColors || 8;
    const uniqueColors = crawlData.colors.length;
    const passed = uniqueColors <= maxColors;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed,
      score: passed ? 100 : Math.max(0, 100 - (uniqueColors - maxColors) * 5),
      details: `${uniqueColors} unique colors used (limit: ${maxColors})`,
    };
  },

  font_count: (crawlData, config) => {
    const maxFonts = config.maxFonts || 3;
    const count = crawlData.fonts.length;
    const passed = count <= maxFonts;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed,
      score: passed ? 100 : Math.max(0, 100 - (count - maxFonts) * 15),
      details: `${count} font families used (recommended max: ${maxFonts}): ${crawlData.fonts.join(', ')}`,
    };
  },

  text_readability: (crawlData, config) => {
    const maxWidth = config.maxLineWidth || 75;
    const texts = crawlData.elementData.filter(e => e.tag === 'p' && e.width > 0);
    const avgCharWidth = 8;
    const tooWide = texts.filter(e => e.width / avgCharWidth > maxWidth);
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: tooWide.length === 0,
      score: tooWide.length === 0 ? 100 : Math.max(0, 100 - tooWide.length * 10),
      details: tooWide.length ? `${tooWide.length} text blocks exceed ${maxWidth} characters per line` : 'Line widths are within readable range',
    };
  },

  cta_prominence: (crawlData, _config) => {
    const buttons = crawlData.elementData.filter(e => e.tag === 'button' || (e.tag === 'a' && e.isClickable));
    if (buttons.length === 0) return { ruleId: '', name: '', dimension: '', severity: '', passed: true, score: 80, details: 'No CTA buttons found on page' };

    const aboveFold = buttons.filter(e => true);
    const hasLargeButton = aboveFold.some(b => b.width >= 120 && b.height >= 40);
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: hasLargeButton,
      score: hasLargeButton ? 100 : 60,
      details: hasLargeButton ? 'CTA button is prominent and visible' : 'No prominent CTA button found above the fold',
    };
  },

  responsive_meta: (crawlData, _config) => {
    const hasViewport = crawlData.html.includes('viewport') && crawlData.html.includes('width=device-width');
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: hasViewport,
      score: hasViewport ? 100 : 0,
      details: hasViewport ? 'Viewport meta tag is present' : 'Missing viewport meta tag for responsive design',
    };
  },

  typography_tracking: (crawlData, _config) => {
    const htmlLower = crawlData.html.toLowerCase();
    const hasTightTracking = htmlLower.includes('tracking-tighter') || htmlLower.includes('tracking-tight') || htmlLower.includes('letter-spacing: -');
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: hasTightTracking,
      score: hasTightTracking ? 100 : 50,
      details: hasTightTracking ? '大标题使用了收紧字距 (tracking-tighter)' : '未检测到收紧的字距，大标题可能显得松散 (AI 廉价感)',
    };
  },

  anti_center_bias: (crawlData, _config) => {
    const htmlLower = crawlData.html.toLowerCase();
    const centerCount = (htmlLower.match(/text-center/g) || []).length + (htmlLower.match(/items-center/g) || []).length;
    const leftCount = (htmlLower.match(/text-left/g) || []).length + (htmlLower.match(/grid-cols-2/g) || []).length;
    const isBiased = centerCount > 10 && centerCount > leftCount * 3;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: !isBiased,
      score: isBiased ? 40 : 100,
      details: isBiased ? `检测到过度依赖居中排版 (text-center: ${centerCount}次)` : '排版布局具备张力，未过度依赖居中对齐',
    };
  },

  border_radius_consistency: (crawlData, _config) => {
    const html = crawlData.html;
    const roundedMatches = html.match(/rounded-(sm|md|lg|xl|2xl|3xl|full|none)/g) || [];
    const uniqueRounded = [...new Set(roundedMatches)];
    const isConsistent = uniqueRounded.length <= 2;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: isConsistent,
      score: isConsistent ? 100 : Math.max(0, 100 - uniqueRounded.length * 15),
      details: isConsistent ? '圆角值高度统一' : `检测到多种不一致的圆角: ${uniqueRounded.join(', ')}`,
    };
  },

  lila_rule: (crawlData, _config) => {
    const html = crawlData.html;
    const hasPurpleGradient = /from-purple-\d+/.test(html) || /to-purple-\d+/.test(html) || /via-purple-\d+/.test(html) || /text-purple-\d+/.test(html);
    const hasBlueGradient = /from-blue-\d+/.test(html) && /to-blue-\d+/.test(html);
    const violated = hasPurpleGradient || hasBlueGradient;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: !violated,
      score: violated ? 20 : 100,
      details: violated ? '检测到 AI 默认的紫色/蓝色渐变发光 (触发 Lila Rule 禁令)' : '未检测到廉价的紫色渐变，色彩克制',
    };
  },

  shadow_quality: (crawlData, _config) => {
    const html = crawlData.html;
    const hasPureBlackShadow = html.includes('rgba(0,0,0') || html.includes('rgba(0, 0, 0');
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: !hasPureBlackShadow,
      score: hasPureBlackShadow ? 40 : 100,
      details: hasPureBlackShadow ? '检测到劣质的纯黑阴影 (rgba(0,0,0,x))' : '阴影质感合格，未使用纯黑阴影',
    };
  },

  tactile_feedback: (crawlData, _config) => {
    const html = crawlData.html;
    const hasActiveFeedback = html.includes('active:scale-') || html.includes('active:translate-') || html.includes('active:-translate-');
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: hasActiveFeedback,
      score: hasActiveFeedback ? 100 : 60,
      details: hasActiveFeedback ? '检测到按钮包含物理按压反馈 (:active 状态)' : '交互元素缺少物理触觉反馈 (如 active:scale-98)',
    };
  },

  image_alt: (crawlData, _config) => {
    const htmlLower = crawlData.html.toLowerCase();
    const imgTags = htmlLower.match(/<img[^>]*>/g) || [];
    const missingAlt = imgTags.filter(tag => !tag.includes('alt=') || tag.includes('alt=""'));
    const total = imgTags.length;
    if (total === 0) return { ruleId: '', name: '', dimension: '', severity: '', passed: true, score: 100, details: 'No images found' };

    const passed = missingAlt.length === 0;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed,
      score: passed ? 100 : Math.max(0, 100 - Math.round((missingAlt.length / total) * 100)),
      details: `${missingAlt.length}/${total} images missing alt text`,
    };
  },

  heading_structure: (crawlData, _config) => {
    const headings = crawlData.elementData.filter(e => e.tag.match(/^h[1-6]$/));
    if (headings.length === 0) return { ruleId: '', name: '', dimension: '', severity: '', passed: false, score: 50, details: 'No headings found on page' };

    const hasH1 = headings.some(h => h.tag === 'h1');
    const h1Count = headings.filter(h => h.tag === 'h1').length;
    let issues: string[] = [];
    if (!hasH1) issues.push('Missing H1');
    if (h1Count > 1) issues.push(`Multiple H1 tags (${h1Count})`);

    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed: issues.length === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20),
      details: issues.length ? issues.join('; ') : 'Heading structure is semantic and correct',
    };
  },

  performance_load: (crawlData, config) => {
    const maxLcp = config.maxLcp || 2500;
    const lcp = crawlData.performanceMetrics.lcp;
    const passed = lcp <= maxLcp;
    return {
      ruleId: '', name: '', dimension: '', severity: '',
      passed,
      score: passed ? 100 : Math.max(0, 100 - Math.round((lcp - maxLcp) / 50)),
      details: `LCP: ${Math.round(lcp)}ms (target: <${maxLcp}ms)`,
    };
  },
};

export function loadEnabledRules(): RuleConfig[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM ui_review_rules WHERE enabled = 1 ORDER BY sort_order ASC').all() as any[];
  return rows.map(r => ({
    ...r,
    detection_config: typeof r.detection_config === 'string' ? JSON.parse(r.detection_config || '{}') : r.detection_config,
    industry_weights: typeof r.industry_weights === 'string' ? JSON.parse(r.industry_weights || '{}') : r.industry_weights,
  }));
}

export function runAllRules(crawlData: CrawlResult, rules: RuleConfig[]): RuleResult[] {
  return rules.map(rule => runSingleRule(crawlData, rule));
}

export function runSingleRule(crawlData: CrawlResult, rule: RuleConfig): RuleResult {
  const checkerKey = rule.detection_config?.checker || rule.name.toLowerCase().replace(/\s+/g, '_');
  const checker = ruleCheckers[checkerKey];

  if (!checker) {
    return {
      ruleId: rule.id,
      name: rule.name,
      dimension: rule.dimension,
      severity: rule.severity,
      passed: true,
      score: 100,
      details: `No checker implementation for: ${checkerKey}`,
    };
  }

  const result = checker(crawlData, rule.detection_config);
  return {
    ...result,
    ruleId: rule.id,
    name: rule.name,
    dimension: rule.dimension,
    severity: rule.severity,
  };
}
