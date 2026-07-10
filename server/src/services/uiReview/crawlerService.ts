import { chromium, type Browser, type Page } from 'playwright';

export interface CrawlResult {
  screenshot: Buffer;
  html: string;
  domSummary: string;
  techStack: string[];
  fonts: string[];
  colors: string[];
  performanceMetrics: { lcp: number; cls: number; fid: number };
  viewport: { width: number; height: number };
  elementData: ElementData[];
}

export interface ElementData {
  tag: string;
  selector: string;
  text: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  backgroundColor: string;
  padding: string;
  margin: string;
  width: number;
  height: number;
  isClickable: boolean;
}

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

export async function crawlPage(url: string): Promise<CrawlResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ fullPage: false });
    const html = await page.content();

    const analysisData = await page.evaluate(() => {
      const elements: any[] = [];
      const allColors = new Set<string>();
      const allFonts = new Set<string>();
      const techIndicators: string[] = [];

      // Tech stack detection
      const htmlStr = document.documentElement.outerHTML;
      if (htmlStr.includes('__next') || htmlStr.includes('_next')) techIndicators.push('Next.js');
      if (htmlStr.includes('__nuxt') || document.querySelector('#__nuxt')) techIndicators.push('Nuxt');
      if ((window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ || htmlStr.includes('react')) techIndicators.push('React');
      if ((window as any).__VUE__) techIndicators.push('Vue');
      if (htmlStr.includes('tailwind') || document.querySelector('[class*="tw-"]') || document.querySelector('[class*="flex "]')) techIndicators.push('Tailwind CSS');
      if (document.querySelector('[class*="ant-"]')) techIndicators.push('Ant Design');
      if (document.querySelector('[class*="el-"]')) techIndicators.push('Element UI');
      if (document.querySelector('[class*="MuiBox"]') || document.querySelector('[class*="Mui"]')) techIndicators.push('Material UI');

      // Analyze visible elements
      const selectors = 'h1,h2,h3,h4,h5,h6,p,a,button,input,img,nav,header,footer,main,section,[role="button"]';
      const nodes = document.querySelectorAll(selectors);
      const viewportHeight = window.innerHeight;

      nodes.forEach((node, idx) => {
        if (idx > 100) return;
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.top > viewportHeight * 1.5 || rect.height === 0) return;

        const computed = window.getComputedStyle(el);
        const color = computed.color;
        const bgColor = computed.backgroundColor;
        const font = computed.fontFamily;

        allColors.add(color);
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') allColors.add(bgColor);
        allFonts.add(font.split(',')[0].trim().replace(/['"]/g, ''));

        const tag = el.tagName.toLowerCase();
        const isClickable = tag === 'a' || tag === 'button' || tag === 'input' || el.getAttribute('role') === 'button' || computed.cursor === 'pointer';

        // Build a simple selector
        let selector = tag;
        if (el.id) selector = `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(c => c && !c.includes(':'))[0];
          if (cls) selector = `${tag}.${cls}`;
        }

        elements.push({
          tag,
          selector,
          text: (el.textContent || '').slice(0, 80).trim(),
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          color,
          backgroundColor: bgColor,
          padding: computed.padding,
          margin: computed.margin,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          isClickable,
        });
      });

      return {
        elements,
        colors: [...allColors],
        fonts: [...allFonts],
        techStack: techIndicators,
      };
    });

    // Performance metrics
    const perfMetrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        lcp: perf ? perf.loadEventEnd - perf.startTime : 0,
        cls: 0,
        fid: 0,
      };
    });

    // Build DOM summary for LLM
    const domSummary = buildDomSummary(analysisData.elements);

    return {
      screenshot,
      html,
      domSummary,
      techStack: analysisData.techStack,
      fonts: analysisData.fonts,
      colors: analysisData.colors,
      performanceMetrics: perfMetrics,
      viewport: { width: 1440, height: 900 },
      elementData: analysisData.elements,
    };
  } finally {
    await context.close();
  }
}

function buildDomSummary(elements: ElementData[]): string {
  const headings = elements.filter(e => e.tag.match(/^h[1-6]$/));
  const buttons = elements.filter(e => e.tag === 'button' || e.tag === 'a' && e.isClickable);
  const texts = elements.filter(e => e.tag === 'p');

  let summary = '## Page Structure\n';
  summary += `Total visible elements analyzed: ${elements.length}\n\n`;

  if (headings.length) {
    summary += '### Headings\n';
    headings.forEach(h => {
      summary += `- ${h.tag}: "${h.text}" (size: ${h.fontSize}, weight: ${h.fontWeight})\n`;
    });
    summary += '\n';
  }

  if (buttons.length) {
    summary += '### Interactive Elements\n';
    buttons.slice(0, 10).forEach(b => {
      summary += `- ${b.selector}: "${b.text}" (${b.width}x${b.height}px)\n`;
    });
    summary += '\n';
  }

  if (texts.length) {
    summary += '### Text Content\n';
    texts.slice(0, 5).forEach(t => {
      summary += `- ${t.selector}: "${t.text.slice(0, 60)}" (size: ${t.fontSize})\n`;
    });
  }

  return summary;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
