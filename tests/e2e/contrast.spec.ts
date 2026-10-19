import { test, expect, type Page } from "@playwright/test";

async function readableText(page: Page, state: string) {
  const failures = await page.evaluate(() => {
    const rgba = (value: string) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    };
    const composite = (foreground: number[], background: number[]) =>
      foreground
        .slice(0, 3)
        .map(
          (channel, i) =>
            channel * foreground[3] + background[i] * (1 - foreground[3]),
        );
    const background = (element: Element) => {
      const ancestors: Element[] = [];
      for (
        let current: Element | null = element;
        current;
        current = current.parentElement
      )
        ancestors.unshift(current);
      return ancestors.reduce(
        (color, ancestor) =>
          composite(rgba(getComputedStyle(ancestor).backgroundColor), color),
        [255, 255, 255],
      );
    };
    const luminance = (color: number[]) =>
      color
        .map((channel) => {
          const s = channel / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.visibility === "visible" &&
        !element.closest(
          'script, style, noscript, [aria-hidden="true"], :disabled',
        )
      );
    };
    const errors: { text: string; ratio: number; selector: string }[] = [];
    const check = (element: Element, text: string, color: string) => {
      const bg = background(element);
      const fg = composite(rgba(color), bg);
      const a = luminance(fg),
        b = luminance(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5)
        errors.push({
          text: text.trim().slice(0, 35),
          ratio: Math.round(ratio * 100) / 100,
          selector: element.className.toString(),
        });
    };
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (parent && node.textContent?.trim() && visible(parent))
        check(parent, node.textContent, getComputedStyle(parent).color);
    }
    document
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >("input[placeholder], textarea[placeholder]")
      .forEach((input) => {
        if (visible(input))
          check(
            input,
            input.placeholder,
            getComputedStyle(input, "::placeholder").color,
          );
      });
    return errors;
  });
  expect(failures, `${state} 的可见文字及输入提示需达到 4.5:1 对比度`).toEqual(
    [],
  );
}

test("首页、结果、设置、指南及历史的文字保持清晰对比", async ({
  page,
}, info) => {
  const health = page.waitForResponse((r) => r.url().endsWith("/api/health"));
  await page.goto("/");
  await health;
  await readableText(page, "首页");
  await page
    .getByRole("button", { name: "搜索功能或笔记", exact: true })
    .click();
  await readableText(page, "功能搜索");
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: "体验示例" }).click();
  await expect(
    page.getByRole("heading", { name: "核心观点", exact: true }),
  ).toBeVisible();
  await readableText(page, "AI 笔记");
  await page.getByRole("tab", { name: /原文字幕/ }).click();
  await readableText(page, "原文字幕");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "服务设置", exact: true }),
  ).toBeVisible();
  await readableText(page, "设置弹窗");
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: "查看使用指南", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "让每段内容，都有收获。" }),
  ).toBeVisible();
  await readableText(page, "使用指南");
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("tab", { name: "粘贴文本" }).click();
  await page.getByLabel("字幕或文本").fill("阅读清晰的本机历史笔记。");
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "打开导航" }).click();
    await readableText(page, "手机导航");
  }
  await page.getByRole("button", { name: /本机历史/ }).click();
  await expect(
    page.getByRole("button", { name: "打开笔记" }).first(),
  ).toBeVisible();
  await readableText(page, "本机历史");
});
