import { test, expect } from "@playwright/test";

test("搜索功能、本机笔记和空结果，支持 Ctrl K", async ({ page }) => {
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/health"),
  );
  await page.goto("/");
  await loaded;
  await page
    .getByRole("button", { name: "搜索功能或笔记", exact: true })
    .click();
  const search = page.getByRole("textbox", { name: "搜索功能和本机笔记" });
  await expect(search).toBeFocused();
  await search.fill("粘贴");
  await page.getByRole("button", { name: /粘贴字幕 直接整理/ }).click();
  await expect(page.getByRole("tab", { name: "粘贴文本" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("字幕或文本").fill("搜索也能找到本机笔记的正文。");
  await page.getByRole("button", { name: "提取字幕", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
  await search.fill("本机笔记的正文");
  await page.getByRole("button", { name: /我的文本笔记/ }).click();
  await expect(
    page
      .getByRole("region", { name: "字幕与 AI 笔记结果" })
      .getByText("搜索也能找到本机笔记的正文。", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await search.fill("不存在的搜索结果abcdef");
  await expect(
    page.getByText("没有找到相关功能或笔记，试试其他关键词。"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("应用安装清单及所有图标可用", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.id).toBe("/");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok(), icon.src).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
    expect((await image.body()).readUInt32BE(16)).toBe(
      Number(icon.sizes.split("x")[0]),
    );
  }
  for (const rel of ["icon", "apple-touch-icon"]) {
    const links = await page
      .locator(`link[rel="${rel}"]`)
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href")!),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const href of links)
      expect((await request.get(href)).ok(), href).toBe(true);
  }
});
