// 江苏大学(ujs.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 出现问题请联系作者或者提交直接pr更改,这更加快速

// 基于GSMC修改
// 作者：洛初 Github@gongfuture

// 2026.03.30 第一版
// 通过正方接口 xskbcx_cxXsgrkb 拉取个人课表，解析课程名、教师、教室、星期、节次和周次（含单双周）。
// 交互上依次询问学年、学期与作息类型（夏令时/冬令时/智能选择，智能选择按固定切令时日期判定）。
// 按课程所在楼栋匹配上午与下午作息，写入课程的自定义时间；导入课程、课表配置与预设时间段。

// 2026.08.23 第二版
// 桥接接口升级至 v2（window.shiguangBridge / window.shiguangBridgePromise）。
// 补充开学日期：从首页日历区块取当前学期起止日期写入 semesterStartDate，总周数改为按实际周次取值；
// 取不到开学日期时跳过配置保存，避免覆盖用户已有设置。
// 课程备注补充重修标记、选课备注（体育项目、微专业等）与周次原文。
// 集中实践课（军训、毕业设计等）无星期节次无法排课，改为弹窗提示手动添加。
// 教师与教室为空不再丢弃课程；修正京江各号楼的楼栋匹配；支持校外 WebVPN 访问。

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); // 匹配以数字周结束的

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 拼接教务系统接口地址。
 * 校内直连时 location.origin 就是教务域名，前缀为空；
 * 校外经 WebVPN 访问时路径带有 /http/<hex> 前缀，必须保留，否则会变成跨域请求。
 */
function buildApiUrl(path) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const prefix = prefixMatch ? prefixMatch[0] : "";
    return window.location.origin + prefix + path;
}

/**
 * 拼装课程备注。
 * xm 只有姓名，kcmc 只有课程名，以下信息只存在于原始字段里，
 * 放进备注方便用户核对：重修标记、选课备注（体育项目、微专业等）、周次原文。
 */
function buildCourseRemark(rawCourse) {
    const parts = [];

    const retakeFlag = String(rawCourse.cxbjmc || "").trim();
    if (retakeFlag) {
        parts.push(retakeFlag);
    }

    const selectionNote = String(rawCourse.xkbz || "").trim();
    if (selectionNote) {
        parts.push(selectionNote);
    }

    const weekDesc = String(rawCourse.zcd || "").trim();
    if (weekDesc) {
        parts.push(weekDesc);
    }

    return parts.join(" | ");
}

/**
 * 解析集中实践课列表（sjkList）。
 * 这类课程（军事技能训练、形势与政策等）只有课程名、教师和起止周，
 * 没有星期和节次，无法映射到周课表，只能提示用户手动添加。
 */
function parsePracticeCourses(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.sjkList)) {
        return [];
    }

    return jsonData.sjkList
        .map((item) => ({
            name: String(item.kcmc || "").trim(),
            teacher: String(item.jsxm || "").trim(),
            weekDesc: String(item.qsjsz || "").trim()
        }))
        .filter((item) => item.name);
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    // 检查JSON结构：新的数据在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段检查：只有 kcmc(课名), xqj(星期), jcs(节次范围), zcd(周次描述) 是排课必需的。
        // xm(教师) 与 cdmc(教室) 在实践课、线上课、未排地点的课程上可能为空，
        // 缺这两项不影响排课，不能因此丢弃整门课程。
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            // console.warn(`JS: 课程 ${rawCourse.kcmc} 星期或节次数据无效，跳过。`);
            continue;
        }

        const remark = buildCourseRemark(rawCourse);

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        };

        if (remark) {
            course.remark = remark;
        }

        finalCourseList.push(course);
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

/**
 * 检查当前是否处于夏令时作息时间段。
 * @returns true 夏令时 false 冬令时
 */
async function whetherSummerTimeSlot() {

    // // 教务处 校历/作息时间 公告页
    // const url = "https://jwc.ujs.edu.cn/index/xl_zuo_xi_shi_jian.htm";
    // let title = "";

    // try {
    //     const response = await fetch(url);
    //     if (!response.ok) {
    //         throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
    //     }

    //     const html = await response.text();
    //     const doc = new DOMParser().parseFromString(html, "text/html");

    //     // 优先按页面固定 id 读取：#line_u8_0, #line_u8_1 ...
    //     for (let i = 0; i < 30; i++) {
    //         const a = doc.querySelector(`#line_u8_${i} > a`);
    //         if (!a) continue;
    //         title = (a.getAttribute("title") || a.textContent || "").trim();
    //         if (title.includes("作息时间表")) {
    //             break;
    //         }
    //     }

    //     // 若固定 id 没取到，则扫描所有链接文本
    //     if (title.trim().length === 0) {
    //         const links = doc.querySelectorAll("a");
    //         for (const link of links) {
    //             title = (link.getAttribute("title") || link.textContent || "").trim();
    //             if (title.includes("作息时间表")) {
    //                 break;
    //             }
    //         }
    //     }

    //     // 从公告中提取日期
    //     if (title.trim().length === 0) {
    //         throw new Error("未找到作息时间公告标题。");
    //     }
    //     const match = title.match(/[（(]\s*(\d{4})年(\d{1,2})月(\d{1,2})日起执行\s*[）)]/);
    //     if (!match) {
    //         throw new Error("公告标题格式不匹配，无法提取执行日期。");
    //     }
    //     const y = Number(match[1]);
    //     const m = Number(match[2]);
    //     const d = Number(match[3]);
    //     const changeDate = new Date(y, m - 1, d);

    //     const now = new Date();
    //     if (changeDate.getMonth() === 3 && now >= changeDate ) { // 4月7日开始夏令时
    //         return true;
    //     } else if (changeDate.getMonth() === 9 && now < changeDate) { // 10月7日开始冬令时
    //         return true;
    //     } else {
    //         return false;
    //     }

    // } catch (error) {
    //     console.error('JS: 获取作息时间公告失败:', error);
    //     window.shiguangBridge.showToast("无法获取作息时间公告，智能选择回退到预设时间。");

    //     // 预设日期
    //     const summerStart = new Date(new Date().getFullYear(), 3, 7); // 4月7日
    //     const winterStart = new Date(new Date().getFullYear(), 9, 7); // 10月7日

    //     const now = new Date();
    //     if (now >= summerStart && now < winterStart) {
    //         return true; // 夏令时
    //     } else {
    //         return false; // 冬令时
    //     }
    // }

    // CORS 问题导致无法获取公告页，智能选择回退到预设时间。
    // 冬令时是十一假期结束后调整，取 10 月 7 日；夏令时公告历年均为 4 月 7 日起执行。
    // 参考教务处历年作息时间表公告：https://jwc.ujs.edu.cn/index/xl_zuo_xi_shi_jian.htm

    // 预设日期
    const summerStart = new Date(new Date().getFullYear(), 3, 7); // 4月7日
    const winterStart = new Date(new Date().getFullYear(), 9, 7); // 10月7日

    const now = new Date();
    if (now >= summerStart && now < winterStart) {
        return true; // 夏令时
    } else {
        return false; // 冬令时
    }
}

/**
 * 计算本次导入的作息何时失效。
 * 作息时间是导入时一次性写死的，不会自动跟随切令时变化，
 * 所以这里返回下一个「切到另一种令时」的日期，用于提示用户届时重新导入。
 * 夏令时 4 月 7 日起执行，冬令时十一假期后（10 月 7 日）起执行。
 */
function getNextTimeSlotSwitchDate(isSummerTime) {
    const now = new Date();
    const year = now.getFullYear();
    const targetLabel = isSummerTime ? "冬令时" : "夏令时";

    const candidates = [
        { date: new Date(year, 3, 7), label: "夏令时" },
        { date: new Date(year, 9, 7), label: "冬令时" },
        { date: new Date(year + 1, 3, 7), label: "夏令时" },
        { date: new Date(year + 1, 9, 7), label: "冬令时" }
    ];

    const next = candidates.find((item) => item.date > now && item.label === targetLabel);

    return {
        label: next.label,
        text: `${next.date.getFullYear()}年${next.date.getMonth() + 1}月${next.date.getDate()}日`
    };
}

/**
 * 检查是否在登录页面。
 * 校内直连时地址是 http://jwxt.ujs.edu.cn/sso/jziotlogin，
 * 校外经 WebVPN 时地址是 https://webvpn.ujs.edu.cn/http/<hex>/sso/jziotlogin，
 * 因此按路径结尾判断，两种入口都能识别。
 */
function isLoginPage() {
    return window.location.pathname.endsWith("/sso/jziotlogin");
}


function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        console.log("JS: validateYearInput 验证通过。");
        return false;
    } else {
        console.log("JS: validateYearInput 验证失败。");
        return "请输入四位数字的学年！";
    }
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    const currentMonth = new Date().getMonth() + 1; // 月份从0开始，所以加1
    // 如果当前月份在8月或之后，默认学年是当前年份-下一年份，否则是上一年份-当前年份
    const defaultYear = currentMonth >= 8 ? currentYear : (Number(currentYear) - 1).toString(); 
    console.log("JS: 提示用户输入学年。");
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（如2025-2026 应该填2025）:",
        defaultYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    const currentMonth = new Date().getMonth() + 1; // 月份从0开始，所以加1
    const defaultSemesterIndex = currentMonth >= 8 ? 0 : 1; // 如果当前月份在8月或之后，默认选择第一学期，否则选择第二学期
    console.log("JS: 提示用户选择学期。");
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );
    return semesterIndex;
}

async function selectTimeSlot() {
    const timeSlots = ["智能选择" ,"夏令时", "冬令时"];
    console.log("JS: 提示用户选择作息类型。");
    const timeSlotIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(timeSlots),
        0
    );
    return timeSlotIndex;
}

async function reselectTimeSlot(selectedTimeSlot) {
    const options = ["对的对的，就是这个", "不对不对，应该是另外一个"];
    const dialogTitle = "当前智能选择结果为: \n  " + (selectedTimeSlot ? "夏令时" : "冬令时") + "\n是否更改选择？";
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        dialogTitle,
        JSON.stringify(options),
        0
    );

    if (selectedIndex === null || selectedIndex === -1) {
        return false;
    }

    // 选中第 2 项（索引 1）表示“需要改成另外一个”。
    return selectedIndex === 1;
}

/**
 * 将选择索引转换为 API 所需的学期码。
 */
function getSemesterCode(semesterIndex) {
    // semesterIndex 3 (第一学期), 12 (第二学期)
    return semesterIndex === 0 ? "3" : "12";
}


/**
 * 获取教务系统当前学期的起止日期。
 * 首页日历区块的标题形如 "2026-2027学年1学期(2026-08-31至2027-02-21)"，
 * 其中起始日期就是第 1 周周一，正是 semesterStartDate 需要的值。
 * 注意：该接口忽略 xnm/xqm 参数，只返回当前学期，
 * 因此只有用户选择的学年学期与返回值一致时才能使用。
 */
async function fetchCurrentSemesterRange() {
    const url = buildApiUrl("/xtgl/index_cxAreaFive.html?localeKey=zh_CN&gnmkdm=index");

    try {
        const response = await fetch(url, {
            "headers": {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            "body": "",
            "method": "POST",
            "credentials": "include"
        });

        if (!response.ok) {
            throw new Error(`状态码 ${response.status}`);
        }

        const html = await response.text();
        const match = html.match(/(\d{4})-\d{4}学年(\d)学期\s*[（(](\d{4}-\d{2}-\d{2})至(\d{4}-\d{2}-\d{2})[）)]/);

        if (!match) {
            console.warn("JS: 未能从日历区块解析出学期起止日期。");
            return null;
        }

        const range = {
            academicYear: match[1],
            semesterIndex: Number(match[2]) - 1,
            startDate: match[3],
            endDate: match[4]
        };
        console.log("JS: 教务系统当前学期:", range);
        return range;

    } catch (error) {
        console.warn("JS: 获取学期起止日期失败:", error);
        return null;
    }
}

/**
 * 计算课表配置。
 *
 * 应用侧的 saveCourseConfig 是整体覆盖而非字段级合并：没有传入的字段会被写成模型默认值，
 * 其中 semesterStartDate 的默认值是 null，会把用户已经设置好的开学日期清空。
 * 所以拿不到真实开学日期时返回 null，由调用方跳过整个配置保存，宁可不写也不要写坏。
 *
 * defaultClassDuration / defaultBreakDuration 不显式传入，会被重置为应用默认的 45 / 10 分钟，
 * 与江大「45 分钟一节、课间 10 分钟」一致，因此没有副作用。
 */
function buildCourseConfig(courses, semesterRange, firstDayOfWeek) {
    if (!semesterRange) {
        return null;
    }

    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }

    return {
        semesterStartDate: semesterRange.startDate,
        // 只增不减：默认 20 周，课表里出现更大的周次时才扩展。
        semesterTotalWeeks: Math.max(maxWeek, 20),
        firstDayOfWeek: firstDayOfWeek
    };
}


/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = getSemesterCode(semesterIndex);

    // API URL 和请求体
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = buildApiUrl("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151");

    console.log(`JS: 发送请求到 ${url}, body: ${xnmXqmBody}`);

    const requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        "body": xnmXqmBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }

        const jsonText = await response.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error('JS: JSON 解析失败，可能是会话过期:', e);
            window.shiguangBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课，或教务系统需要二次登录。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);

        console.log("JS: 课程列表预览:", courses.slice(0, 5)); // 预览前5门课程

        // 集中实践课（军训、形势与政策等）没有星期和节次，无法排进周课表，单独取出用于提示。
        const practiceCourses = parsePracticeCourses(jsonData);
        if (practiceCourses.length > 0) {
            console.log(`JS: 检测到 ${practiceCourses.length} 门集中实践课，无法自动导入。`);
        }

        // qsxqj: 教务系统设置的一周起始星期几，缺失时按周一处理。
        const rawFirstDay = Number(jsonData.qsxqj);
        const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;

        return {
            courses: courses,
            practiceCourses: practiceCourses,
            firstDayOfWeek: firstDayOfWeek
        };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

/**
 * 只在能拿到真实开学日期时写入课表配置。
 * 拿不到就完全不调用 saveCourseConfig —— 应用侧是整体覆盖，
 * 传入不含 semesterStartDate 的配置会把用户已设置的开学日期清空。
 */
async function saveCourseConfigIfPossible(courses, academicYear, semesterIndex, firstDayOfWeek) {
    const semesterRange = await fetchCurrentSemesterRange();

    let usableRange = null;
    if (semesterRange) {
        const sameYear = semesterRange.academicYear === String(academicYear);
        const sameSemester = semesterRange.semesterIndex === semesterIndex;

        if (sameYear && sameSemester) {
            usableRange = semesterRange;
        } else {
            console.log(
                `JS: 所选学年学期(${academicYear}/第${semesterIndex + 1}学期)` +
                `不是教务系统当前学期(${semesterRange.academicYear}/第${semesterRange.semesterIndex + 1}学期)，跳过开学日期写入。`
            );
        }
    }

    const config = buildCourseConfig(courses, usableRange, firstDayOfWeek);

    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        console.log("JS: 无可用开学日期，跳过 saveCourseConfig 以保留用户现有配置。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            `课表配置更新成功！开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }
}

// 上午作息时间
// 北固及本部主楼、主A楼、生环楼、汽车能动楼、京江楼
const AMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
];

// 三江楼、材料楼、机械楼、新校区各教学楼
const BMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
];

// 三山楼、讲堂群、实践楼
const CMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
];

// 夏令时 
// 下午作息时间
// 北固
const DSummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
];

// 本部
const ESummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
];

// 晚上作息时间
const SummerEveningTimeSlots = [
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" },
];

// 冬令时
// 下午作息时间
// 北固
const DWinterAfternoonTimeSlots = [
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:20", endTime: "16:05" },
    { number: 8, startTime: "16:15", endTime: "17:00" },
];

// 本部
const EWinterAfternoonTimeSlots = [
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:25", endTime: "17:10" },
];

// 晚上作息时间
const WinterEveningTimeSlots = [
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:25", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:05" },
];

// 全局默认作息
// 夏令时
const SummerTimeSlots = [...AMorningTimeSlots, ...ESummerAfternoonTimeSlots, ...SummerEveningTimeSlots];

// 冬令时
const WinterTimeSlots = [...AMorningTimeSlots, ...EWinterAfternoonTimeSlots, ...WinterEveningTimeSlots];

function getCampusTypeFromPosition(position) {
    const normalized = String(position || "").replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    // const firstPart = normalized.split(" ")[0] || "";
    // if (firstPart.includes("北固")) return "D";
    // if (firstPart.includes("本部")) return "E";

    // // 兜底：有些数据可能不按空格分段，补充全文匹配。
    // if (normalized.includes("北固")) return "D";
    // if (normalized.includes("本部")) return "E";

    // api好像不返回前缀了，我也不确定北固是怎么样的格式，只能这么写了()
    const firstPart = normalized.split(" ")[0] || "";
    if (firstPart.includes("北固") || normalized.includes("北固")) return "D";
    return "E"; // 其他默认本部

    // return null;
}

function getMorningTypeFromPosition(position) {
    const text = String(position || "").trim();

    // 教务系统返回的是「京江2号楼2101」「京江3号楼3407」这类名称，没有「京江楼」这个写法，
    // 所以这里匹配「京江」而不是「京江楼」。
    if (text.includes("主A楼") || text.includes("京江")) return "A";
    if (text.includes("三江楼")) return "B";
    if (text.includes("三山楼") || text.includes("讲堂群")) return "C";

    return null;
}

function buildCourseTimeSlotsByPosition(position, isSummerTime) {
    const morningType = getMorningTypeFromPosition(position);
    const campusType = getCampusTypeFromPosition(position);

    // 仅对指定楼宇做自定义。
    if (!morningType || !campusType) {
        return null;
    }

    const morningTimeSlots = morningType === "A"
        ? AMorningTimeSlots
        : morningType === "B"
            ? BMorningTimeSlots
            : CMorningTimeSlots;

    const afternoonTimeSlots = isSummerTime
        ? (campusType === "D" ? DSummerAfternoonTimeSlots : ESummerAfternoonTimeSlots)
        : (campusType === "D" ? DWinterAfternoonTimeSlots : EWinterAfternoonTimeSlots);

    const eveningTimeSlots = isSummerTime ? SummerEveningTimeSlots : WinterEveningTimeSlots;

    return [...morningTimeSlots, ...afternoonTimeSlots, ...eveningTimeSlots];
}

function applyCustomTimeToCourses(courses, isSummerTime) {
    let customizedCount = 0;
    let skippedCount = 0;

    const updatedCourses = courses.map((course) => {
        const courseTimeSlots = buildCourseTimeSlotsByPosition(course.position, isSummerTime);
        if (!courseTimeSlots) {
            skippedCount += 1;
            return course;
        }

        const slotMap = new Map(courseTimeSlots.map((slot) => [slot.number, slot]));
        const startSlot = slotMap.get(course.startSection);
        const endSlot = slotMap.get(course.endSection);

        if (!startSlot || !endSlot) {
            skippedCount += 1;
            console.warn(`JS: 课程 ${course.name} 的节次(${course.startSection}-${course.endSection})未命中自定义时间映射，回退为普通节次。`);
            return course;
        }

        customizedCount += 1;
        return {
            ...course,
            isCustomTime: true,
            customStartTime: startSlot.startTime,
            customEndTime: endSlot.endTime,
        };
    });

    console.log(`JS: 自定义时间处理完成，命中 ${customizedCount} 门，跳过 ${skippedCount} 门。`);
    return updatedCourses;
}


async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);

    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}


async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    // // 与后续流程并发执行，提前缓存智能选择结果。
    // const smartTimeSlotPromise = whetherSummerTimeSlot();
    // console.log("JS: 智能作息判定已并发启动。");

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);


    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 选择学期失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const timeSlotIndex = await selectTimeSlot();
    if (timeSlotIndex === null || timeSlotIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 选择作息类型失败/取消，流程终止。");
        return;
    }

    let isSummerTime = false;
    if (timeSlotIndex === 1) {
        isSummerTime = true;
    } else if (timeSlotIndex === 2) {
        isSummerTime = false;
    } else {
        // try {
        //     isSummerTime = await smartTimeSlotPromise;
        // } catch (error) {
        //     console.error("JS: 智能作息判定异常，回退重新判定:", error);
        //     isSummerTime = await whetherSummerTimeSlot();
        // }
        isSummerTime = await whetherSummerTimeSlot();
        const shouldReselect = await reselectTimeSlot(isSummerTime);
        if (shouldReselect) {
            isSummerTime = !isSummerTime;
        }

    }
    console.log(`JS: 作息类型: ${isSummerTime ? "夏令时" : "冬令时"}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, practiceCourses, firstDayOfWeek } = result;

    const coursesWithCustomTime = applyCustomTimeToCourses(courses, isSummerTime);

    // 作息时间在导入时一次性写入，不会自动跟随切令时变化，需要明确告知用户。
    // 同时说明只有部分教学楼收录了独立作息，其余楼栋使用默认作息时间。
    const nextSwitch = getNextTimeSlotSwitchDate(isSummerTime);
    await window.shiguangBridgePromise.showAlert(
        "作息时间提示",
        `本次按${isSummerTime ? "夏令时" : "冬令时"}导入。作息时间在导入时写入，不会自动跟随学校切换令时。\n` +
        `${nextSwitch.text}起学校切换为${nextSwitch.label}，届时请重新导入课表，或在应用内手动修改时间段。\n\n` +
        "脚本已根据课程所在位置匹配作息时间，部分课程可能与预设时间不符。\n" +
        "请在课表页面核对课程时间，如有错误请手动修改课程所在位置或节次信息。\n\n" +
        "已收录独立作息的楼栋：主A楼、京江各号楼、三江楼、三山楼、讲堂群。\n" +
        "其余楼栋（各学院楼、各实验室、运动场、未排地点等）使用默认作息时间。\n\n" +
        "欢迎其他楼栋的同学提供课程时间信息以完善脚本！",
        "我知道了"
    );

    if (practiceCourses.length > 0) {
        const practiceList = practiceCourses
            .map((item) => {
                const teacher = item.teacher ? `（${item.teacher}）` : "";
                const weekDesc = item.weekDesc ? ` ${item.weekDesc}` : "";
                return `· ${item.name}${teacher}${weekDesc}`;
            })
            .join("\n");

        console.log("JS: 集中实践课列表:", practiceCourses);
        await window.shiguangBridgePromise.showAlert(
            "集中实践课需手动添加",
            `本学期有 ${practiceCourses.length} 门集中实践课，教务系统未给出星期和节次，无法自动导入：\n\n` +
            practiceList +
            "\n\n请按实际安排在应用内手动添加。",
            "我知道了"
        );
    }

    const saveResult = await saveCourses(coursesWithCustomTime);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    await saveCourseConfigIfPossible(coursesWithCustomTime, academicYear, semesterIndex, firstDayOfWeek);

    await importPresetTimeSlots(isSummerTime ? SummerTimeSlots : WinterTimeSlots);


    window.shiguangBridge.showToast(`课程导入成功，共导入 ${coursesWithCustomTime.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
