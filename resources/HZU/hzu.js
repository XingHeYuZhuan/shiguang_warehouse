// 菏泽学院强智教务：新版学期理论课表（viweType=0）。
// 参考仓库 CSUFT/MKU 的新版强智 DOM 结构，按本站实测重写。
// 不保存登录凭据；Android 电脑模式借用 App 原生请求通道同步会话。

const HZU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:30", endTime: "16:20" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:40", endTime: "18:30" },
    { number: 9, startTime: "19:30", endTime: "20:20" },
    { number: 10, startTime: "20:30", endTime: "21:20" }
];

function hzuUrl(path) {
    const pathname = window.location.pathname;
    const index = pathname.indexOf("/jsxsd/");
    if (index < 0 && !pathname.endsWith("/jsxsd")) {
        throw new Error("请先登录菏泽学院教务系统，再开始导入。");
    }
    const prefix = index >= 0 ? pathname.slice(0, index) : pathname.slice(0, -6);
    return window.location.origin + prefix + "/jsxsd" + path;
}

async function hzuFetchDocument(path, options = {}) {
    const url = new URL(hzuUrl(path));
    const nativeRequests = typeof window.WebPostService?.register === "function";
    if (url.origin !== "https://222.206.176.102") {
        throw new Error("请从菏泽学院 HTTPS 教务入口运行适配。");
    }
    if (nativeRequests) {
        if (!/Windows NT/.test(navigator.userAgent)) {
            throw new Error("请开启软件的电脑模式后，再点击导入。");
        }
        if (options.method === "POST" && !window._postInterceptInjected) {
            throw new Error("软件的登录请求通道未初始化，请刷新页面后重试。");
        }
        // 此内部参数使普通 GET 也走原生通道；App 转发前会移除它。
        url.searchParams.set("_webview_post_id", "hzu_" + Date.now() + "_" + Math.random().toString(36).slice(2));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(url.href, {
            ...options,
            credentials: "include",
            cache: "no-store",
            signal: controller.signal
        });
        if (!response.ok) throw new Error("教务请求失败：HTTP " + response.status);
        return new DOMParser().parseFromString(await response.text(), "text/html");
    } finally {
        clearTimeout(timer);
    }
}

// 与学校 conwork.js 一致：按 UTF-16 码元编码，不能替换为 UTF-8 Base64。
function hzuEncodeInp(input) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    let index = 0;
    do {
        const first = input.charCodeAt(index++);
        const second = input.charCodeAt(index++);
        const third = input.charCodeAt(index++);
        const a = first >> 2;
        const b = ((first & 3) << 4) | (second >> 4);
        let c = ((second & 15) << 2) | (third >> 6);
        let d = third & 63;
        if (Number.isNaN(second)) c = d = 64;
        else if (Number.isNaN(third)) d = 64;
        output += alphabet.charAt(a) + alphabet.charAt(b) + alphabet.charAt(c) + alphabet.charAt(d);
    } while (index < input.length);
    return output;
}

function hzuLoginParameters(doc, account, password) {
    const form = doc.querySelector('form[name="loginForm"]');
    if (!form || form.getAttribute("method")?.toLowerCase() !== "post") {
        throw new Error("教务登录页面已变化，无法继续登录。");
    }
    const action = new URL(form.getAttribute("action"), hzuUrl("/"));
    if (action.href !== hzuUrl("/xk/LoginToXk")) {
        throw new Error("教务登录地址已变化，已停止提交。");
    }
    const extraInputs = Array.from(form.querySelectorAll("input")).filter(input =>
        input.type !== "hidden" && !["userAccount", "userPassword"].includes(input.id));
    if (extraInputs.length) {
        throw new Error("当前登录需要额外验证，暂不支持自动提交。");
    }
    const script = Array.from(doc.scripts).filter(item => !item.src).map(item => item.textContent).join("\n");
    let scode = script.match(/\bvar\s+scode\s*=\s*["']([a-zA-Z0-9]+)["']\s*;/)?.[1];
    const sxh = script.match(/\bvar\s+sxh\s*=\s*["']([123]{55})["']\s*;/)?.[1];
    if (!scode || !sxh || scode.length !== Array.from(sxh).reduce((sum, value) => sum + Number(value), 0)) {
        throw new Error("未获取到有效的实时登录编码参数，请重试。");
    }
    const code = hzuEncodeInp(account) + "%%%" + hzuEncodeInp(password) + "%%%" + hzuEncodeInp(" ");
    let encoded = "";
    for (let index = 0; index < code.length; index++) {
        if (index >= 55) {
            encoded += code.slice(index);
            break;
        }
        const count = Number(sxh[index]);
        encoded += code[index] + scode.slice(0, count);
        scode = scode.slice(count);
    }
    const params = new URLSearchParams();
    for (const input of form.querySelectorAll('input[type="hidden"][name]')) {
        if (!input.disabled) params.append(input.name, input.value);
    }
    params.set("userAccount", account);
    params.set("encoded", encoded);
    return params;
}

function hzuLoginMessage(doc) {
    return doc.querySelector("#showMsg")?.textContent.trim() || "登录未成功，请核对账号和密码后重试。";
}

async function hzuSubmitLogin(body) {
    let result = null;
    let interrupted = false;
    try {
        result = await hzuFetchDocument("/xk/LoginToXk", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body
        });
    } catch (error) {
        const nativeRequests = typeof window.WebPostService?.register === "function";
        if (!nativeRequests || !["TypeError", "AbortError"].includes(error.name)) throw error;
        // App 已同步重定向响应的 Cookie，但非主页面的 3xx 会退回 WebView 而报网络错误。
        // 不重发登录 POST，只用原生 GET 验证服务器是否已经建立会话。
        interrupted = true;
    }
    if (result?.querySelector('form[name="loginForm"]')) throw new Error(hzuLoginMessage(result));
    const doc = await hzuFetchDocument("/xskb/xskb_list.do?viweType=0&zc=");
    if (interrupted && doc.querySelector('form[name="loginForm"]')) {
        throw new Error("登录请求已中断，且未能确认登录会话，请重试。");
    }
    // HTTP 200 或网络错误都不能单独判定登录结果，课表会话才是依据。
    hzuSemesters(doc);
    return doc;
}

async function hzuLogin() {
    if (document.getElementById("hzu-login")) throw new Error("登录窗口已打开。");
    const host = document.createElement("div");
    host.id = "hzu-login";
    const shadow = host.attachShadow({ mode: "open" });
    // 独立表单不依赖学校的 jQuery/layui，也不执行远程页面里的脚本。
    shadow.innerHTML = `
        <style>
            :host { all: initial; }
            * { box-sizing: border-box; letter-spacing: 0; }
            dialog {
                position: fixed; inset: 0; margin: auto; width: min(400px, calc(100% - 24px));
                max-height: calc(100% - 24px); padding: 24px; overflow: auto;
                border: 1px solid #d9dee3; border-radius: 8px; background: #fff; color: #20252b;
                font: 16px/1.5 system-ui, sans-serif;
            }
            dialog::backdrop { background: rgba(0, 0, 0, .45); }
            header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            h2 { margin: 0; font-size: 22px; }
            button { font: inherit; cursor: pointer; }
            button:disabled { cursor: wait; opacity: .65; }
            #close { width: 36px; height: 36px; flex: 0 0 36px; border: 0; background: none; font-size: 24px; }
            label { display: block; margin-top: 16px; font-size: 14px; }
            input { display: block; width: 100%; min-width: 0; height: 44px; margin-top: 6px;
                padding: 8px 10px; border: 1px solid #929ca6; border-radius: 4px; font: inherit; }
            input:focus-visible, button:focus-visible { outline: 2px solid #1769a3; outline-offset: 2px; }
            #submit { width: 100%; min-height: 44px; margin-top: 20px; border: 0; border-radius: 4px;
                background: #1769a3; color: #fff; }
            #error { margin: 12px 0 0; color: #b42318; font-size: 14px; overflow-wrap: anywhere; }
            #error:empty { display: none; }
        </style>
        <dialog aria-labelledby="title">
            <header><h2 id="title">菏泽学院</h2><button id="close" type="button" aria-label="取消登录" title="取消登录">&times;</button></header>
            <form>
                <label for="account">账号</label>
                <input id="account" type="text" autocomplete="username" required>
                <label for="password">密码</label>
                <input id="password" type="password" autocomplete="off" required>
                <p id="error" role="alert"></p>
                <button id="submit" type="submit">登录并导入</button>
            </form>
        </dialog>`;
    document.body.appendChild(host);
    const dialog = shadow.querySelector("dialog");
    const form = shadow.querySelector("form");
    const accountInput = shadow.querySelector("#account");
    const passwordInput = shadow.querySelector("#password");
    const submit = shadow.querySelector("#submit");
    const close = shadow.querySelector("#close");
    const error = shadow.querySelector("#error");
    let busy = false;
    try {
        return await new Promise(resolve => {
            const cancel = () => {
                if (!busy) resolve(null);
            };
            close.addEventListener("click", cancel);
            dialog.addEventListener("cancel", event => {
                event.preventDefault();
                cancel();
            });
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (busy) return;
                if (!accountInput.value.trim() || !passwordInput.value) {
                    error.textContent = "账号和密码不能为空。";
                    return;
                }
                busy = true;
                submit.disabled = close.disabled = accountInput.disabled = passwordInput.disabled = true;
                submit.textContent = "正在登录...";
                error.textContent = "";
                try {
                    const loginDoc = await hzuFetchDocument("/");
                    if (!loginDoc.querySelector('form[name="loginForm"]')) {
                        const doc = await hzuFetchDocument("/xskb/xskb_list.do?viweType=0&zc=");
                        hzuSemesters(doc);
                        resolve(doc);
                        return;
                    }
                    const body = hzuLoginParameters(loginDoc, accountInput.value.trim(), passwordInput.value).toString();
                    passwordInput.value = "";
                    const doc = await hzuSubmitLogin(body);
                    resolve(doc);
                } catch (failure) {
                    error.textContent = failure.message || "登录请求失败，请重试。";
                } finally {
                    passwordInput.value = "";
                    busy = false;
                    submit.disabled = close.disabled = accountInput.disabled = passwordInput.disabled = false;
                    submit.textContent = "登录并导入";
                }
            });
            dialog.showModal();
            accountInput.focus();
        });
    } finally {
        passwordInput.value = "";
        dialog.close();
        host.remove();
    }
}

function hzuSemesters(doc) {
    const select = doc.querySelector("#xnxq01id");
    if (!select) throw new Error("登录已失效或未获取到课表页面，请重新登录。");
    return Array.from(select.options).filter(option => option.value).map(option => ({
        value: option.value,
        text: option.textContent.trim(),
        selected: option.selected
    }));
}

function hzuCheckSemester(doc, semesterId) {
    const value = doc.querySelector("#xnxq")?.value || doc.querySelector("#xnxq01id")?.value;
    if (value !== semesterId) throw new Error("教务返回的学期与所选学期不一致，请重新查询。");
}

function hzuNumbers(text, limit) {
    const numbers = [];
    const parts = text.replace(/\s/g, "").split(/[,，、]/);
    for (const part of parts) {
        const match = part.match(/^(\d+)(?:[-~～—至](\d+))?$/);
        if (!match) throw new Error("无法识别周次或节次：" + text);
        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > limit) throw new Error("周次或节次超出范围：" + text);
        for (let number = start; number <= end; number++) numbers.push(number);
    }
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function hzuParseTime(text) {
    const sectionMatch = text.match(/[\[［]([^[\]［］]+)节[\]］]/);
    if (!sectionMatch || !text.slice(0, sectionMatch.index).includes("周")) {
        throw new Error("课程缺少有效的周次或节次：" + text);
    }
    const weekText = text.slice(0, sectionMatch.index).replace(/第|周|\s/g, "");
    const weeks = [];
    for (const part of weekText.split(/[,，、]/)) {
        const parity = part.match(/[（(]?(单|双)[）)]?$/);
        const range = parity ? part.slice(0, parity.index) : part;
        weeks.push(...hzuNumbers(range, 100).filter(week =>
            !parity || week % 2 === (parity[1] === "单" ? 1 : 0)));
    }
    const sections = hzuNumbers(sectionMatch[1], 30);
    // 不连续的节次拆开，不能把未上课的小节填进连续区间。
    const ranges = [];
    for (const section of sections) {
        const last = ranges[ranges.length - 1];
        if (last && last.endSection + 1 === section) last.endSection = section;
        else ranges.push({ startSection: section, endSection: section });
    }
    const sortedWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
    if (!sortedWeeks.length) throw new Error("课程周次为空：" + text);
    return { weeks: sortedWeeks, ranges };
}

function hzuGrid(table) {
    const grid = [];
    Array.from(table.rows).forEach((row, r) => {
        if (!grid[r]) grid[r] = [];
        let column = 0;
        Array.from(row.cells).forEach(cell => {
            while (grid[r][column]) column++;
            for (let dr = 0; dr < (cell.rowSpan || 1); dr++) {
                if (!grid[r + dr]) grid[r + dr] = [];
                for (let dc = 0; dc < (cell.colSpan || 1); dc++) {
                    grid[r + dr][column + dc] = cell;
                }
            }
            column += cell.colSpan || 1;
        });
    });
    return grid;
}

function hzuField(text, label) {
    return (text.match(new RegExp(label + "[:：]\\s*([^;；]*)")) || [])[1]?.trim() || "";
}

function hzuParseCourses(doc) {
    const table = doc.querySelector('td[name="kbDataTd"]')?.closest("table");
    if (!table) {
        if (doc.querySelector("#xnxq01id")) return [];
        throw new Error("未获取到课表，请重新登录教务系统。");
    }
    const grid = hzuGrid(table);
    const days = new Map();
    const dayNames = "一二三四五六日";
    for (const row of grid) {
        row.forEach((cell, column) => {
            if (cell.tagName !== "TH") return;
            const match = cell.textContent.trim().match(/^(?:星期|周)([一二三四五六日天])/);
            if (match) days.set(column, match[1] === "天" ? 7 : dayNames.indexOf(match[1]) + 1);
        });
    }
    if (days.size !== 7) throw new Error("无法识别课表的星期表头，已停止导入。");

    const seen = new Set();
    const merged = new Map();
    for (const row of grid) {
        for (const [column, day] of days) {
            const cell = row[column];
            if (!cell || seen.has(cell) || cell.getAttribute("name") !== "kbDataTd") continue;
            seen.add(cell);
            // 只读简表课程，跳过同一格内 tooltip 的重复详情。
            for (const item of cell.querySelectorAll("ul.courselists > li.courselists-item")) {
                const name = item.querySelector(".qz-hasCourse-title")?.textContent.trim();
                const info = item.querySelector(".qz-hasCourse-abbrinfo")?.textContent.trim() || "";
                if (!name) throw new Error("课表中有无法识别的课程名称，已停止导入。");
                const time = hzuParseTime(hzuField(info, "时间"));
                const teacher = hzuField(info, "老师");
                const location = hzuField(info, "地点");
                const position = /^[（(]\s*[）)]$/.test(location) ? "" : location;
                for (const range of time.ranges) {
                    const key = JSON.stringify([name, teacher, position, day, range.startSection, range.endSection]);
                    if (merged.has(key)) {
                        const course = merged.get(key);
                        course.weeks = Array.from(new Set(course.weeks.concat(time.weeks))).sort((a, b) => a - b);
                    } else {
                        merged.set(key, { name, teacher, position, day, ...range, weeks: time.weeks.slice() });
                    }
                }
            }
        }
    }
    return Array.from(merged.values());
}

function hzuCalendar(doc, semesterId) {
    hzuCheckSemester(doc, semesterId);
    const table = doc.querySelector("#dataTable");
    if (!table) throw new Error("未找到教学周历。");
    const anchors = [];
    let totalWeeks = 0;
    for (const row of table.rows) {
        const match = row.cells[0]?.textContent.match(/第\s*(\d+)\s*周/);
        if (!match) continue;
        const week = Number(match[1]);
        if (week < 1 || week > 100) throw new Error("教学周历周次异常。");
        totalWeeks = Math.max(totalWeeks, week);
        for (let day = 0; day < 7; day++) {
            const cell = row.cells[day + 1];
            const date = cell?.textContent.match(/(\d{1,2})月(\d{1,2})日/);
            if (date) anchors.push({ offset: (week - 1) * 7 + day, month: Number(date[1]), day: Number(date[2]) });
        }
    }
    if (!anchors.length || !totalWeeks) throw new Error("教学周历缺少日期。");
    anchors.sort((a, b) => a.offset - b.offset);
    const term = semesterId.match(/^(\d{4})-\d{4}-([12])$/);
    if (!term) throw new Error("无法识别校历学期。");
    const first = anchors[0];
    const year = Number(term[1]) + (term[2] === "2" || first.month < 7 ? 1 : 0);
    const dayMs = 86400000;
    const startMs = Date.UTC(year, first.month - 1, first.day) - first.offset * dayMs;
    if (new Date(startMs).getUTCDay() !== 1 || anchors.some(anchor => {
        const date = new Date(startMs + anchor.offset * dayMs);
        return date.getUTCMonth() + 1 !== anchor.month || date.getUTCDate() !== anchor.day;
    })) throw new Error("教学周历日期不一致，无法确定开学日期。");
    return { semesterStartDate: new Date(startMs).toISOString().slice(0, 10), semesterTotalWeeks: totalWeeks };
}

async function hzuRunImportFlow() {
    const bridge = window.shiguangBridge;
    const api = window.shiguangBridgePromise;
    if (!bridge || !api) throw new Error("未检测到拾光桥接接口，请在软件或测试插件中运行。");
    if (!await api.showAlert("菏泽学院课表导入", "将读取所选学期的全部周课程。未登录时会打开登录窗口。", "开始导入")) return;

    bridge.showToast("正在读取学期列表...");
    let firstDoc = await hzuFetchDocument("/xskb/xskb_list.do?viweType=0&zc=");
    if (firstDoc.querySelector('form[name="loginForm"]')) {
        firstDoc = await hzuLogin();
        if (!firstDoc) return;
    }
    const semesters = hzuSemesters(firstDoc);
    if (!semesters.length) throw new Error("教务未提供可导入的学期。");
    const index = await api.showSingleSelection("选择学期",
        JSON.stringify(semesters.map(semester => semester.text)),
        Math.max(0, semesters.findIndex(semester => semester.selected)));
    if (index === null) return;
    if (!Number.isInteger(index) || !semesters[index]) throw new Error("学期选择无效。");
    const semesterId = semesters[index].value;
    const params = new URLSearchParams({ viweType: "0", zc: "", xnxq01id: semesterId });
    const mode = firstDoc.querySelector("#kbjcmsid")?.value;
    if (mode) params.set("kbjcmsid", mode);
    const doc = await hzuFetchDocument("/xskb/xskb_list.do?" + params);
    hzuCheckSemester(doc, semesterId);
    const courses = hzuParseCourses(doc);
    if (!courses.length) {
        bridge.showToast("该学期暂无已排课课程，未修改原有课表。");
        return;
    }

    let config = null;
    try {
        config = hzuCalendar(await hzuFetchDocument("/jxzl/jxzl_query?xnxq01id=" +
            encodeURIComponent(semesterId)), semesterId);
        if (courses.some(course => course.weeks.some(week => week > config.semesterTotalWeeks))) {
            throw new Error("课程周次超出教学周历。");
        }
    } catch (_) {
        config = null;
        if (!await api.showAlert("教学周历不可用",
            "无法确定所选学期的开学日期与总周数。继续导入后，请在课表设置中核对学期配置。", "继续导入")) return;
    }

    // 只在全部读取和确认完成后写入；保存失败不能发出完成信号。
    if (config) {
        config.firstDayOfWeek = 1;
        config.defaultClassDuration = 50;
        config.defaultBreakDuration = 10;
        if (await api.saveCourseConfig(JSON.stringify(config)) === false) throw new Error("学期配置保存失败。");
    }
    if (await api.savePresetTimeSlots(JSON.stringify(HZU_TIME_SLOTS)) === false) {
        throw new Error("作息时间保存失败。");
    }
    if (await api.saveImportedCourses(JSON.stringify(courses)) === false) throw new Error("课程保存失败。");
    bridge.showToast("成功导入 " + courses.length + " 条上课记录");
    bridge.notifyTaskCompletion();
}

// Start import.
if (!window._hzuImportRunning) {
    window._hzuImportRunning = true;
    hzuRunImportFlow().catch(error => {
        console.error("HZU import failed:", error);
        if (window.shiguangBridge) window.shiguangBridge.showToast("导入失败：" + error.message);
    }).finally(() => {
        window._hzuImportRunning = false;
    });
}
