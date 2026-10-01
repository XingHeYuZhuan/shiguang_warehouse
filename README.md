# shiguang_warehouse

本仓库用于 shiguangschedule 适配脚本的管理和测试。所有适配脚本将集中存放于此，方便软件拉取和测试。

## 仓库结构说明

- `schools.json`：适配学校索引列表，包含所有已适配学校的关键信息。
- `schools/`：存放各学校的适配代码，每个学校一个独立的 JS 文件。
- `LICENSE`：开源协议文件。

## schools.json 字段说明

每个学校索引应包含以下字段：

| 字段名         | 类型    | 说明                                   |
| -------------- | ------- | -------------------------------------- |
| `id`           | String  | 学校唯一标识（建议用拼音或英文缩写）    |
| `name`         | String  | 学校中文全称                           |
| `initial`      | String  | 学校名称的首字母，用于排序和查找        |
| `importUrl`    | String  | 教务系统登录的 URL                      |
| `assetJsPath`  | String  | 适配脚本路径（如 `schools/school.js`）  |
| `maintainer`   | String  | 维护者信息（如姓名或 GitHub 用户名）    |
| `category`   | String  | 适配类别。 `BACHELOR_AND_ASSOCIATE` 表示“本科/专科”，`POSTGRADUATE` 表示“研究生”，`GENERAL_TOOL` 表示“通用工具”。 |

示例：
```json
[
  {
    "id": "school_Cs",
    "name": "测试大学(这是一个空网站，用于组件测试)",
    "initial": "C",
    "importUrl": "",
    "assetJsPath": "schools/school.js",
   "maintainer": "星河欲转",
   "category": "GENERAL_TOOL"
  }
]
```

**注意：**  
- 请严格按照上述字段填写，不要添加或减少字段。
- `importUrl` 一定要是登录页面。
- `assetJsPath` 填写对应学校的适配脚本路径。
- `maintainer` 填写维护者信息，便于后续沟通和维护。

## 开发流程

1.  **Fork 仓库**

      - 所有开发者需先 fork 本仓库（本仓库带有 `lighthouse` 标签，已经在开发者软件版本关闭检查逻辑，希望各位开发者对使用的git仓库链接负责）。

3.  **添加适配代码**

      - 在 `schools/` 文件夹下新建对应学校的适配 JS 文件。
      - 在 `schools.json` 中添加学校索引信息，确保各字段填写完整。

4.  **软件测试**

      - 开发者需要安装 dev(开发者版，图标红色)版本app,在软件的“我的-更多-更新仓库”中选择**自定义仓库或私有仓库**，来拉取并更新自己的仓库代码进行实际测试，完成 Beta 阶段适配验证。

5.  **提交 PR**

      - 测试通过后，提交 Pull Request，等待审核合并。

## 社区约束

- 禁止恶意抹除公开代码的原始开发者的代码贡献记录。
- 未经相关授权，禁止在脱离官方分支的包中包含其他开发者的适配代码，仅可使用自己所有的适配代码。其他开发者的适配代码仅能在官方仓库或其分支中使用。
- **例外情况**：如果您的分支或私有适配仓库仅用于官方 app 的内部测试或个人使用（即仅在官方 app 范围内显示和调用，不对外分发或公开），则可以包含其他开发者的适配代码。  
  但如果您的分支或包对外分发、公开或用于非官方 app，则只能包含您自己拥有的适配代码，不能包含其他开发者的适配代码，除非获得相关授权。
- 允许开发者建立私有仓库或分支本软件，但需遵守上述约定。

本约束为社区规范，鼓励所有使用者自觉遵守。

## 注意事项

- 请确保 `schools.json` 信息准确，入口文件路径与实际文件一致。
- 每次提交适配代码或索引信息后，建议自测通过再提交 PR。
- 仓库需保留 `lighthouse` 标签，否则软件无法识别为适配仓库。

## 更多链接  
**[如何适配](https://github.com/XingHeYuZhuan/shiguangschedule/wiki/%E5%A6%82%E4%BD%95%E9%80%82%E9%85%8D%E6%95%99%E5%8A%A1)**  

**[浏览器测试插件](https://github.com/XingHeYuZhuan/shiguang_Tester)**

---  

如有问题或建议，欢迎提交 Issue 或 PR。
