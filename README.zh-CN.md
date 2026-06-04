# Riyuexi Prompt Folders

一个给 SillyTavern 预设提示词管理器使用的文件夹折叠扩展。

## 安装

把 `ST-RiyuexiPromptFolders` 文件夹放到：

```text
SillyTavern/public/scripts/extensions/third-party/
```

然后重启 SillyTavern，或在扩展面板重新加载扩展。

建议停用或移除旧的 `ST-PromptFolding`，不要两个折叠扩展同时启用。

## 使用

1. 打开 OpenAI 预设提示词管理器。
2. 点击顶部的文件夹按钮，或打开文件夹面板后点击“整理文件夹”。
3. 勾选要作为文件夹标题的条目。
4. 按 SillyTavern 原本的拖动方式，把条目拖到文件夹标题下面。
5. 点击悬浮栏的完成按钮。

文件夹配置会保存到当前预设的 `extensions.riyuexi_prompt_folders` 中，并额外写入浏览器本地缓存，避免切换预设时因为预设未及时落盘而丢失。

## 备注

- 文件夹标题本身仍然是普通 prompt 条目。
- 关闭某个文件夹标题时，该文件夹下的子条目会在发送给模型前被过滤。
- 文件夹标题右侧数字显示该文件夹内启用的子条目数。
- 面板只保留整理、展开、收起、启用、重置这些核心功能。
