/**
 * 西安石油大学教务系统（青果/树维 EAMS）课表导入适配脚本
 *
 * 适配系统：青果 EAMS 教务系统
 * 登录入口：https://ids.xsyu.edu.cn/authserver/（统一身份认证）
 * 教务系统：https://jwxt.xsyu.edu.cn/eams/login.action
 *
 * 原理：
 * 1. 通过 eams/courseTableForStd.action 探测学生 ID 与学期组件 tagId
 * 2. 通过 eams/dataQuery.action 获取学期列表，供用户选择
 * 3. 通过 eams/courseTableForStd!courseTable.action 拉取课表数据
 * 4. 课表数据中课程信息由 JavaScript 脚本动态注入（new TaskActivity(...)），从脚本中提取课程
 *
 * 作息时间：默认使用雁塔校区作息（与教务处开学通知一致），
 * 鄠邑校区作息如有差异可在导入后于 App 内调整。
 */
(function () {
    // 自动适应当前教务域名，方便校内/校外入口切换
    const BASE = window.location.origin;

    // ---------- 工具函数 ----------

    function truncateText(value, maxLen) {
        const text = String(value == null ? "" : value);
        if (text.length <= maxLen) return text;
        return `${text.slice(0, maxLen)}...`;
    }

    function toast(message) {
        if (window.AndroidBridge && AndroidBridge.showToast) {
            AndroidBridge.showToast(message);
        } else {
            console.log(message);
        }
    }

    async function showAlert(title, message) {
        if (window.AndroidBridgePromise && window.AndroidBridgePromise.showAlert) {
            return await window.AndroidBridgePromise.showAlert(title, message, "确定");
        }
        alert(`${title}\n${message}`);
        return true;
    }

    async function requestText(url, options) {
        const requestOptions = { credentials: "include", ...options };
        const res = await fetch(url, requestOptions);
        if (!res.ok) {
            throw new Error(`网络请求失败: ${res.status}`);
        }
        return await res.text();
    }

    // 从入口页面 HTML 中提取学生 ID 和学期选择组件的 tagId
    function parseEntryParams(entryHtml) {
        const idsMatch = entryHtml.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
        const tagIdMatch = entryHtml.match(/id="(semesterBar\d+Semester)"/);
        return {
            studentId: idsMatch ? idsMatch[1] : "",
            tagId: tagIdMatch ? tagIdMatch[1] : ""
        };
    }

    // 判断是否仍停留在登录页（未登录时探测会返回登录页）
    function looksLikeLoginPage(html) {
        const text = String(html || "");
        return /login\.action|user_login|loginform|登录/i.test(text) && !/courseTableForStd|TaskActivity/i.test(text);
    }

    // 解析学期列表
    function parseSemesterResponse(rawText) {
        let data;
        try {
            data = Function(`return (${String(rawText || "").trim()});`)();
        } catch (parseError) {
            throw new Error("学期数据解析失败");
        }
        const semesters = [];
        if (!data || !data.semesters || typeof data.semesters !== "object") {
            return semesters;
        }
        Object.keys(data.semesters).forEach((k) => {
            const arr = data.semesters[k];
            if (!Array.isArray(arr)) return;
            arr.forEach((s) => {
                if (!s || !s.id) return;
                semesters.push({
                    id: String(s.id),
                    name: `${s.schoolYear || ""} ${s.name || ""}学期`.trim()
                });
            });
        });
        return semesters;
    }

    // 清除课程名后面的课程序号
    function cleanCourseName(name) {
        return String(name || "").replace(/\([\d.]+\)\s*$/, "").trim();
    }

    // 解析周次位图字符串（'1' 表示该周上课）
    function parseValidWeeksBitmap(bitmap) {
        if (!bitmap || typeof bitmap !== "string") return [];
        const weeks = [];
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === "1") weeks.push(i);
        }
        return weeks;
    }

    function normalizeWeeks(weeks) {
        const list = Array.from(new Set((weeks || []).filter((w) => Number.isInteger(w) && w > 0)));
        list.sort((a, b) => a - b);
        return list;
    }

    // 还原 JavaScript 字面量字符串
    function unquoteJsLiteral(token) {
        const text = String(token || "").trim();
        if (!text) return "";
        if (text === "null" || text === "undefined") return "";
        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1);
        }
        if (text.includes('+') && /^[a-zA-Z_$][\w$]*\s*\+/.test(text)) {
            const varName = text.split('+')[0].trim();
            return varName;
        }
        return text;
    }

    // 分割 JavaScript 函数参数字符串（支持引号内逗号）
    function splitJsArgs(argsText) {
        const args = [];
        let curr = "";
        let inQuote = "";
        let escaped = false;
        for (let i = 0; i < argsText.length; i++) {
            const ch = argsText[i];
            if (escaped) { curr += ch; escaped = false; continue; }
            if (ch === "\\") { curr += ch; escaped = true; continue; }
            if (inQuote) { curr += ch; if (ch === inQuote) inQuote = ""; continue; }
            if (ch === "\"" || ch === "'") { curr += ch; inQuote = ch; continue; }
            if (ch === ",") { args.push(curr.trim()); curr = ""; continue; }
            curr += ch;
        }
        if (curr.trim() || argsText.endsWith(",")) { args.push(curr.trim()); }
        return args;
    }

    // 从脚本中解析教师信息（变量引用的场景）
    function resolveTeachersForTaskActivityBlock(fullText, blockStartIndex) {
        const start = Math.max(0, blockStartIndex - 2200);
        const segment = fullText.slice(start, blockStartIndex);
        const re = /var\s+actTeachers\s*=\s*\[([^]*?)\]\s*;/g;
        let m; let last = null;
        while ((m = re.exec(segment)) !== null) { last = m[1]; }
        if (!last) return "";
        const names = [];
        const nameRe = /name\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
        let nm;
        while ((nm = nameRe.exec(last)) !== null) {
            const name = (nm[1] || nm[2] || "").trim();
            if (name) names.push(name);
        }
        if (names.length === 0) return "";
        return Array.from(new Set(names)).join(",");
    }

    // 从脚本中解析课程名称（变量引用的场景）
    function resolveCourseNameForTaskActivityBlock(fullText, blockStartIndex) {
        const start = Math.max(0, blockStartIndex - 3000);
        const segment = fullText.slice(start, blockStartIndex);
        const re = /(?:var\s+)?courseName\s*=\s*(?:"([^"]*)"|'([^']*)')(?:\s*;)?/gi;
        let match; const values = [];
        while ((match = re.exec(segment)) !== null) {
            const value = (match[1] || match[2] || "").trim();
            if (value) { values.push(value); }
        }
        return values.length > 0 ? values[values.length - 1] : null;
    }

    // 核心：从脚本中解析 TaskActivity 课程
    function parseCoursesFromTaskActivityScript(htmlText) {
        const text = String(htmlText || "");
        if (!text) return [];
        const unitCountMatch = text.match(/\bvar\s+unitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 12;

        const courses = [];
        const activityBlockRegex = /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);([\s\S]*?)(?=var\s+taskId|activity\s*=\s*new|$)/g;

        let blockMatch;
        while ((blockMatch = activityBlockRegex.exec(text)) !== null) {
            const argsText = blockMatch[1];
            const indexAssignmentText = blockMatch[2];
            const args = splitJsArgs(argsText);

            if (args.length < 7) continue;

            const teacherRaw = args[1];
            let teacher = unquoteJsLiteral(teacherRaw);
            if (teacherRaw && !/^['"]/.test(teacherRaw.trim()) && /join\s*\(/.test(teacherRaw)) {
                const resolved = resolveTeachersForTaskActivityBlock(text, blockMatch.index);
                if (resolved) teacher = resolved;
            }

            const nameRaw = args[3];
            let name = unquoteJsLiteral(nameRaw);
            if (nameRaw && !/^['"]/.test(nameRaw.trim()) && /courseName\s*\+/.test(nameRaw)) {
                const resolved = resolveCourseNameForTaskActivityBlock(text, blockMatch.index);
                if (resolved) {
                    const suffixMatch = nameRaw.match(/\+\s*["']([^)]+)["']$/);
                    const suffix = suffixMatch ? suffixMatch[1] : "";
                    name = resolved + (suffix ? `(${suffix})` : "");
                }
            }
            name = cleanCourseName(name);

            let position = unquoteJsLiteral(args[5])
                .replace(/"/g, "")
                .replace(/\(.*\)/g, "")
                .trim();

            const weekBitmap = unquoteJsLiteral(args[6]);
            const weeks = normalizeWeeks(parseValidWeeksBitmap(weekBitmap));
            const indexRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g;
            let indexMatch;
            let sections = [];
            let day = -1;

            while ((indexMatch = indexRegex.exec(indexAssignmentText)) !== null) {
                day = parseInt(indexMatch[1], 10) + 1;
                sections.push(parseInt(indexMatch[2], 10) + 1);
            }

            if (day !== -1 && sections.length > 0) {
                sections.sort((a, b) => a - b);
                courses.push({
                    name: name,
                    teacher: teacher,
                    position: position,
                    day: day,
                    startSection: sections[0],
                    endSection: sections[sections.length - 1],
                    weeks: weeks
                });
            }
        }
        return mergeContiguousSections(courses);
    }

    // 合并同一课程的连续节次（连堂课）
    function mergeContiguousSections(courses) {
        const list = (courses || [])
            .filter((c) => c && c.name && Number.isInteger(c.day) && Number.isInteger(c.startSection) && Number.isInteger(c.endSection))
            .map((c) => ({
                ...c,
                weeks: normalizeWeeks(c.weeks)
            }));
        list.sort((a, b) => {
            const ak = `${a.name}|${a.teacher}|${a.position}|${a.day}|${JSON.stringify(a.weeks)}`;
            const bk = `${b.name}|${b.teacher}|${b.position}|${b.day}|${JSON.stringify(b.weeks)}`;
            if (ak < bk) return -1;
            if (ak > bk) return 1;
            return a.startSection - b.startSection;
        });
        const merged = [];
        for (const item of list) {
            const prev = merged[merged.length - 1];
            const sameCourse = prev
                && prev.name === item.name
                && prev.teacher === item.teacher
                && prev.position === item.position
                && prev.day === item.day
                && JSON.stringify(prev.weeks) === JSON.stringify(item.weeks);
            const isContiguous = sameCourse && prev.endSection + 1 === item.startSection;
            if (isContiguous) {
                prev.endSection = item.endSection;
            } else {
                merged.push({ ...item });
            }
        }
        return merged;
    }

    // 西安石油大学作息时间（雁塔校区，上午 8:00 / 下午 14:30 / 晚上 19:30）
    function getPresetTimeSlots() {
        return [
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
    }

    // ---------- 主流程 ----------

    async function runImportFlow() {
        if (!window.AndroidBridgePromise) {
            throw new Error("AndroidBridgePromise 不可用，无法进行导入交互。");
        }

        AndroidBridge.showToast("开始自动探测教务参数...");

        // 1. 探测学生 ID 和学期组件 tagId
        const entryUrl = `${BASE}/eams/courseTableForStd.action?&sf_request_type=ajax`;
        const entryHtml = await requestText(entryUrl, {
            method: "GET",
            headers: { "x-requested-with": "XMLHttpRequest" }
        });

        if (looksLikeLoginPage(entryHtml)) {
            await showAlert(
                "未登录",
                "检测到当前仍停留在教务登录页，请先完成登录后再次点击导入。"
            );
            return;
        }

        const params = parseEntryParams(entryHtml);
        if (!params.studentId || !params.tagId) {
            await showAlert(
                "参数探测失败",
                "未能识别学生 ID 或学期组件 tagId，请确认已通过统一身份认证进入教务系统后重试。"
            );
            return;
        }

        // 2. 获取学期列表并让用户选择
        const semesterRaw = await requestText(`${BASE}/eams/dataQuery.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `tagId=${encodeURIComponent(params.tagId)}&dataType=semesterCalendar`
        });
        const allSemesters = parseSemesterResponse(semesterRaw);
        if (allSemesters.length === 0) {
            throw new Error("学期列表为空，无法继续导入。");
        }
        const recentSemesters = allSemesters.slice(-8);
        const selectIndex = await window.AndroidBridgePromise.showSingleSelection(
            "请选择导入学期",
            JSON.stringify(recentSemesters.map((s) => s.name || s.id)),
            recentSemesters.length - 1
        );
        if (selectIndex === null) {
            AndroidBridge.showToast("已取消导入");
            return;
        }
        const index = Number.isInteger(Number(selectIndex)) ? Number(selectIndex) : recentSemesters.length - 1;
        const selectedSemester = recentSemesters[index >= 0 && index < recentSemesters.length ? index : recentSemesters.length - 1];
        AndroidBridge.showToast("正在获取课表数据...");

        // 3. 拉取并解析课表
        const courseHtml = await requestText(`${BASE}/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: [
                "ignoreHead=1",
                "setting.kind=std",
                "startWeek=",
                `semester.id=${encodeURIComponent(selectedSemester.id)}`,
                `ids=${encodeURIComponent(params.studentId)}`
            ].join("&")
        });

        const courses = parseCoursesFromTaskActivityScript(courseHtml);
        if (courses.length === 0) {
            const debugInfo = {
                responseLength: String(courseHtml || "").length,
                hasTaskActivity: /new\s+TaskActivity\s*\(/i.test(String(courseHtml || "")),
                hasUnitCount: /\bvar\s+unitCount\s*=\s*\d+/i.test(String(courseHtml || ""))
            };
            await showAlert(
                "解析失败",
                `未能从课表响应中识别到课程。\n响应长度: ${debugInfo.responseLength}\n包含 TaskActivity: ${debugInfo.hasTaskActivity}\n若持续失败请截图反馈开发者。`
            );
            return;
        }

        // 4. 计算学期总周数并保存课程配置
        const allWeeks = courses.flatMap((course) => course.weeks || []);
        const semesterTotalWeeks = allWeeks.length ? Math.max(...allWeeks) : 20;
        if (window.AndroidBridgePromise.saveCourseConfig) {
            await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({
                semesterTotalWeeks,
                semesterStartDate: null,
                firstDayOfWeek: 1
            }));
        }

        // 5. 保存结果
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(getPresetTimeSlots()));

        AndroidBridge.showToast(`导入成功，共 ${courses.length} 条课程`);
        if (window.AndroidBridge && AndroidBridge.notifyTaskCompletion) {
            AndroidBridge.notifyTaskCompletion();
        }
    }

    (async function bootstrap() {
        try {
            await runImportFlow();
        } catch (error) {
            console.error("导入流程失败:", error);
            toast(`导入失败：${error && error.message ? truncateText(error.message, 60) : "请检查教务连接"}`);
            if (window.AndroidBridgePromise && window.AndroidBridgePromise.showAlert) {
                await window.AndroidBridgePromise.showAlert(
                    "导入失败",
                    (error && error.message ? error.message : "请检查网络连接与登录状态后重试。") + "\n\n若持续失败请截图反馈开发者。",
                    "确定"
                );
            }
        }
    })();
})();