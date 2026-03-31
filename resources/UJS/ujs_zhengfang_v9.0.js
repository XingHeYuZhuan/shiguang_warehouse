// 江苏大学(ujs.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 出现问题请联系作者或者提交直接pr更改,这更加快速

// 基于GSMC修改
// 作者：洛初 Github@gongfuture

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
        // 关键字段检查： kcmc(课名), xm(教师), cdmc(教室), xqj(星期), jcs(节次范围), zcd(周次描述)
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
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

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
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
    //     AndroidBridge.showToast("无法获取作息时间公告，智能选择回退到预设时间。");

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

    // 预设日期
    const summerStart = new Date(new Date().getFullYear(), 3, 7); // 4月7日
    const winterStart = new Date(new Date().getFullYear(), 9, 8); // 10月8日

    const now = new Date();
    if (now >= summerStart && now < winterStart) {
        return true; // 夏令时
    } else {
        return false; // 冬令时
    }
}

/**
 * 检查是否在登录页面。
 * 只有当 URL 精确匹配时，才返回 true。
 */
function isLoginPage() {
    const url = window.location.href;
    const loginUrl = "http://jwxt.ujs.edu.cn/sso/jziotlogin";

    // 如果当前 URL 与指定的登录 URL 完全一致，则返回 true (是登录页)
    return url === loginUrl;
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
    return await window.AndroidBridgePromise.showAlert(
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
    return await window.AndroidBridgePromise.showPrompt(
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
    const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );
    return semesterIndex;
}

async function selectTimeSlot() {
    const timeSlots = ["智能选择" ,"夏令时", "冬令时"];
    console.log("JS: 提示用户选择作息类型。");
    const timeSlotIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(timeSlots),
        0
    );
    return timeSlotIndex;
}

async function reselectTimeSlot(selectedTimeSlot) {
    const options = ["对的对的，就是这个", "不对不对，应该是另外一个"];
    const dialogTitle = "当前智能选择结果为: " + (selectedTimeSlot ? "夏令时" : "冬令时") + "，是否更改选择？";
    const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
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
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    AndroidBridge.showToast("正在请求课表数据...");

    const semesterCode = getSemesterCode(semesterIndex);

    // API URL 和请求体
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = "http://jwxt.ujs.edu.cn/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

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
            AndroidBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课，或教务系统需要二次登录。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);

        console.log("JS: 课程列表预览:", courses.slice(0, 5)); // 预览前5门课程

        // 默认总周数为 20，周一为一周第一天。
        const config = {
            semesterTotalWeeks: 20,
            firstDayOfWeek: 1
        };

        // 返回课程列表和配置信息
        return { courses: courses, config: config };

    } catch (error) {
        AndroidBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    AndroidBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
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
    { number: 4, startTime: "11:00", endTime: "11:45" },
];

// 三山楼、讲堂群、实践楼
const CMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:10", endTime: "11:55" },
];

// 夏令时 
// 下午作息时间
// 北固
const DSummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:40", endTime: "17:25" },
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

    if (text.includes("主A楼") || text.includes("京江楼")) return "A";
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
        AndroidBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            AndroidBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        AndroidBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}


async function runImportFlow() {
    if (isLoginPage()) {
        AndroidBridge.showToast("导入失败：请先登录教务系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    // // 与后续流程并发执行，提前缓存智能选择结果。
    // const smartTimeSlotPromise = whetherSummerTimeSlot();
    // console.log("JS: 智能作息判定已并发启动。");

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        AndroidBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);


    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        AndroidBridge.showToast("导入已取消。");
        console.log("JS: 选择学期失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const timeSlotIndex = await selectTimeSlot();
    if (timeSlotIndex === null || timeSlotIndex === -1) {
        AndroidBridge.showToast("导入已取消。");
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
    const { courses, config } = result;

    const coursesWithCustomTime = applyCustomTimeToCourses(courses, isSummerTime);

    // 只匹配了主A楼、京江楼、三江楼、三山楼、讲堂群这几个教学楼的作息时间，其他课程都使用默认时间
    const timeSlotAlert = await window.AndroidBridgePromise.showAlert(
        "楼栋自定义时间提示",
        "脚本已根据课程所在位置智能匹配了作息时间，部分课程可能与预设时间不符。\n" +
        "请在课表页面核对课程时间，如有错误请手动修改课程所在位置或节次信息。\n" +
        "（目前仅主A楼、京江楼、三江楼、三山楼、讲堂群的课程会应用自定义时间，其他课程默认时间不变）\n" +
        "欢迎其他楼栋的同学提供课程时间信息以完善脚本！",
        "我知道了"
    );

    const saveResult = await saveCourses(coursesWithCustomTime);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    try {
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        AndroidBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        AndroidBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }

    await importPresetTimeSlots(isSummerTime ? SummerTimeSlots : WinterTimeSlots);


    AndroidBridge.showToast(`课程导入成功，共导入 ${coursesWithCustomTime.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();