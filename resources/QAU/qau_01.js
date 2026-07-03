/**
 * 青岛农业大学综合教务管理系统（强智科技）
 * by ReGoMark, 2026.07.03
 */

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 解析周次字符串
 * 例如 "1-4,6,11-13" → [1, 2, 3, 4, 6, 11, 12, 13]
 */
function parseWeeks(weekStr) {
    let weeks = [];
    // 去掉括号内的修饰文字，如 "(限选)" "(必修)"
    weekStr = weekStr.replace(/\(.*?\)/g, '').trim();
    let parts = weekStr.split(',');
    for (let part of parts) {
        part = part.trim();
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 解析行标题中的节次范围
 * 例如 "第1,2节" → { start: 1, end: 2 }
 *      "第5节"   → { start: 5, end: 5 }
 *      "第8,9节" → { start: 8, end: 9 }
 */
function parseSectionFromThHeader(thText) {
    // 匹配形如 "第1,2节" 或 "第5节" 或 "第10,11节"
    let match = thText.match(/第([\d,]+)节/);
    if (!match) return null;
    let nums = match[1].split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
    if (nums.length === 0) return null;
    return { start: nums[0], end: nums[nums.length - 1] };
}

// ─────────────────────────────────────────────
// 核心解析
// ─────────────────────────────────────────────

/**
 * 从课表页面的 Document 中提取并去重课程数据
 */
function extractCoursesFromDoc(doc) {
    let parsedCourses = [];

    const table = doc.getElementById('kbtable');
    if (!table) throw new Error("未找到课表表格（#kbtable），请确认已登录教务系统且当前学期有排课。");

    const rows = table.getElementsByTagName('tr');

    // 跳过表头行(0)，从第1行开始（节次数据行）
    // 最后一行是备注行（colspan=7），也跳过
    for (let i = 1; i < rows.length - 1; i++) {
        const row = rows[i];

        // 从该行的 <th> 解析节次范围
        const th = row.querySelector('th');
        if (!th) continue;
        const sectionInfo = parseSectionFromThHeader(th.innerText || th.textContent);
        if (!sectionInfo) continue;

        // 遍历该行的 7 个 <td>（周一到周日）
        const cells = row.getElementsByTagName('td');
        for (let j = 0; j < cells.length; j++) {
            const dayOfWeek = j + 1; // 1=周一 … 7=周日
            const cell = cells[j];

            // 读取详版 div（class="kbcontent"，含教师信息）
            // 注意：不选 kbcontent1（简版，无教师）
            const detailDivs = cell.querySelectorAll('div.kbcontent');
            if (detailDivs.length === 0) continue;

            detailDivs.forEach(div => {
                let htmlContent = div.innerHTML;
                if (!htmlContent.trim() || htmlContent.trim() === '&nbsp;') return;

                // 同一格多门课之间用连续破折号 + <br> 分隔
                let courseBlocks = htmlContent.split(/-{5,}\s*<br\s*\/?>/i);

                courseBlocks.forEach(block => {
                    if (!block.trim() || block.trim() === '&nbsp;') return;

                    let tempDiv = doc.createElement('div');
                    tempDiv.innerHTML = block;

                    let courseObj = {
                        day: dayOfWeek,
                        isCustomTime: false,
                        startSection: sectionInfo.start,
                        endSection: sectionInfo.end
                    };

                    // 1. 提取课程名：取第一行非空纯文本
                    let lines = tempDiv.innerHTML.split(/<br\s*\/?>/i);
                    for (let line of lines) {
                        let cleanLine = line.replace(/<[^>]+>/g, '').trim();
                        if (cleanLine && cleanLine !== '&nbsp;') {
                            courseObj.name = cleanLine;
                            break;
                        }
                    }

                    // 2. 提取教师（QAU 的 title 是 "老师"，不是 "教师"）
                    let teacherFont = tempDiv.querySelector('font[title="老师"]');
                    courseObj.teacher = teacherFont
                        ? (teacherFont.innerText || teacherFont.textContent).trim()
                        : "未知";

                    // 3. 提取教室
                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont
                        ? (positionFont.innerText || positionFont.textContent).trim()
                        : "待定";

                    // 4. 提取周次
                    // QAU 格式：<font title='周次(节次)'>1-4,6,11-13(周)(限选)</font>
                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = (timeFont.innerText || timeFont.textContent).trim();
                        // 提取 "(周)" 之前的部分作为周次
                        let weekMatch = timeText.match(/^(.+?)\(周\)/);
                        if (weekMatch) {
                            courseObj.weeks = parseWeeks(weekMatch[1]);
                        }
                    }

                    if (!courseObj.weeks || courseObj.weeks.length === 0) return;
                    if (!courseObj.name) return;

                    parsedCourses.push(courseObj);
                });
            });
        }
    }

    // ── 去重 ──
    let uniqueCourses = [];
    let courseSet = new Set();
    parsedCourses.forEach(course => {
        let key = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
        if (!courseSet.has(key)) {
            courseSet.add(key);
            uniqueCourses.push(course);
        }
    });

    return uniqueCourses;
}

// ─────────────────────────────────────────────
// 学校定制数据
// ─────────────────────────────────────────────

/**
 * 青岛农业大学作息时间表
 */
function getPresetTimeSlots() {
    return [
        { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
        { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
        { "number": 3,  "startTime": "09:55", "endTime": "10:40" },
        { "number": 4,  "startTime": "10:55", "endTime": "11:35" },
        { "number": 5,  "startTime": "11:35", "endTime": "12:00" },
        { "number": 6,  "startTime": "14:00", "endTime": "14:45" },
        { "number": 7,  "startTime": "14:55", "endTime": "15:40" },
        { "number": 8,  "startTime": "15:55", "endTime": "16:40" },
        { "number": 9,  "startTime": "16:50", "endTime": "17:35" },
        { "number": 10, "startTime": "18:50", "endTime": "19:35" },
        { "number": 11, "startTime": "19:45", "endTime": "20:30" }
    ];
}

function getCourseConfig() {
    return {
        "defaultClassDuration": 45,
        "defaultBreakDuration": 5
    };
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────

async function runImportFlow() {
    try {
        AndroidBridge.showToast("正在获取课表数据，请稍候...");

        const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET' });
        const htmlText = await response.text();
        const parser = new DOMParser();
        let doc = parser.parseFromString(htmlText, 'text/html');

        // 解析学期列表
        const selectElem = doc.getElementById('xnxq01id');
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push((opt.innerText || opt.textContent).trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected')) {
                    defaultIndex = index;
                }
            });
        }

        // 让用户选择学期
        if (semesters.length > 0) {
            let selectedIdx = await window.AndroidBridgePromise.showSingleSelection(
                "请选择要导入的学期",
                JSON.stringify(semesters),
                defaultIndex
            );

            if (selectedIdx === null) {
                AndroidBridge.showToast("已取消导入");
                return;
            }

            if (selectedIdx !== defaultIndex) {
                AndroidBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 课表...`);
                let formData = new URLSearchParams();
                formData.append('xnxq01id', semesterValues[selectedIdx]);

                const postResponse = await fetch('/jsxsd/xskb/xskb_list.do', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });
                const postHtml = await postResponse.text();
                doc = parser.parseFromString(postHtml, 'text/html');
            }
        }

        const courses = extractCoursesFromDoc(doc);

        if (courses.length === 0) {
            await window.AndroidBridgePromise.showAlert(
                "提示",
                "未能解析到任何课程，请检查当前学期是否有排课，或尝试切换学期。",
                "好的"
            );
            return;
        }

        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(getCourseConfig()));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(getPresetTimeSlots()));

        const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saveResult) {
            AndroidBridge.showToast("课程保存失败，请重试！");
            return;
        }

        AndroidBridge.showToast(`成功导入 ${courses.length} 节课程及作息时间！`);
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        AndroidBridge.showToast("导入发生异常: " + error.message);
    }
}

runImportFlow();