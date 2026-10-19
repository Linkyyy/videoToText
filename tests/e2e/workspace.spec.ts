import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  // The health request is made by the mounted client; it also proves hydration completed.
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/health"),
  );
  await page.goto("/");
  await loaded;
}

test("完整的中文首页、示例和字幕时间轴", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(
    page.getByRole("heading", { name: "工作台", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/shijian-home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "体验示例" }).click();
  await expect(
    page.getByText("内置演示内容，用于展示效果，未调用 API。"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "核心观点", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /原文字幕/ }).click();
  await expect(page.getByText("00:32", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 SRT" })).toBeEnabled();
  await page.screenshot({
    path: `/tmp/shijian-result-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("没有 API 密钥也能导入、编辑、导出字幕并恢复本机历史", async ({
  page,
}, testInfo) => {
  await open(page);
  await page.getByRole("tab", { name: "粘贴文本" }).click();
  await page
    .getByLabel("字幕或文本")
    .fill("1\n00:00:01,000 --> 00:00:04,000\n可验证的原始字幕。");
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  await expect(
    page.getByText("可验证的原始字幕。", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SRT" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("我的文本笔记.srt");
  await page.getByRole("button", { name: "编辑字幕", exact: true }).click();
  await page.getByLabel("第 1 段字幕").fill("修正后的字幕。");
  await page.getByRole("button", { name: "完成编辑" }).click();
  await expect(page.getByText("修正后的字幕。", { exact: true })).toBeVisible();
  await page.reload();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: /本机历史/ }).click();
  await page.getByRole("button", { name: "打开笔记" }).first().click();
  await expect(page.getByText("修正后的字幕。", { exact: true })).toBeVisible();
});

test("上传 SRT 文件在浏览器解析，不经过视频处理服务", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "上传文件" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "我的字幕.srt",
      mimeType: "text/plain",
      buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\n文件字幕内容"),
    });
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  await expect(page.getByText("文件字幕内容", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "我的字幕", exact: true }),
  ).toBeVisible();
});

test("模拟 DeepSeek 流式结果，复制与 Markdown 导出", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/health", (r) =>
    r.fulfill({
      json: {
        deepseek: true,
        worker: false,
      },
    }),
  );
  await page.route("**/api/summarize", async (route) => {
    const input = route.request().postDataJSON();
    expect(input.text).toContain("给定的输入内容");
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        [
          { type: "progress", message: "正在整理" },
          { type: "delta", text: "## 测试观点\n\n根据给定内容整理的笔记。" },
          { type: "done" },
        ]
          .map((s) => JSON.stringify(s))
          .join("\n") + "\n",
    });
  });
  await open(page);
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("tab", { name: "粘贴文本" }).click();
  await page.getByLabel("字幕或文本").fill("给定的输入内容");
  await page
    .getByRole("button", { name: "提取字幕并总结", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "测试观点", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "复制当前内容" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "根据给定内容",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
});

test("输入错误及未配置服务的错误可见，原始密钥不出现在页面", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("视频地址").fill("https://127.0.0.1/private");
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  await expect(page.locator(".error-message[role=alert]")).toContainText(
    "暂不支持这个域名",
  );
  await page
    .getByLabel("视频地址")
    .fill("https://www.bilibili.com/video/BV1test");
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  await expect(page.locator(".error-message[role=alert]")).toContainText(
    "尚未配置视频处理服务",
  );
  expect(await page.locator("body").innerText()).not.toContain("sk-");
});
