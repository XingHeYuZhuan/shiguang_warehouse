// 文件: neu.js

async function showCustomSemesterDialog() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);min-width:280px;text-align:center';
        dialog.innerHTML = `
            <div style="font-size:18px;margin-bottom:20px;font-weight:bold">选择学年学期</div>
            <div style="display:flex;align-items:center;justify-content:center;margin-bottom:20px">
                <input type="number" id="startYear" placeholder="起始年份" value="2025" style="width:80px;padding:5px">
                <span style="margin:0 5px">—</span>
                <input type="number" id="endYear" placeholder="结束年份" value="2026" style="width:80px;padding:5px">
            </div>
            <div style="margin-bottom:20px">
                <select id="termSelect" style="width:100%;padding:5px">
                    <option value="fall">秋季学期</option>
                    <option value="spring">春季学期</option>
                </select>
            </div>
            <div style="display:flex;justify-content:space-around">
                <button id="confirmBtn" style="padding:5px 15px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer">确定</button>
                <button id="cancelBtn" style="padding:5px 15px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer">取消</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const startYearInput = dialog.querySelector('#startYear');
        const endYearInput = dialog.querySelector('#endYear');
        const termSelect = dialog.querySelector('#termSelect');
        const confirmBtn = dialog.querySelector('#confirmBtn');
        const cancelBtn = dialog.querySelector('#cancelBtn');

        const cleanup = () => document.body.removeChild(overlay);
        confirmBtn.onclick = () => {
            const start = parseInt(startYearInput.value, 10);
            const end = parseInt(endYearInput.value, 10);
            if (isNaN(start) || isNaN(end)) { alert('请输入有效年份'); return; }
            const semesterNum = termSelect.value === 'fall' ? '1' : '2';
            const semesterCode = `${start}-${end}-${semesterNum}`;
            cleanup();
            resolve({ semesterCode, xnxqdm: semesterCode, xqdm: '01' });
        };
        cancelBtn.onclick = () => { cleanup(); resolve(null); };
    });
}

async function showSemesterSelection() {
    const res = await showCustomSemesterDialog();
    return res ? res.semesterCode : false;
}

// ---------- 校区选择（不变） ----------
async function showCampusSelection() {
    const campuses = ["南湖校区", "浑南校区"];
    try {
        const idx = await window.AndroidBridgePromise.showSingleSelection("选择你所在的校区", JSON.stringify(campuses), 2);
        return idx !== -1 ? campuses[idx] : false;
    } catch(e) {
        AndroidBridge.showToast("显示校区列表出错：" + e.message);
        return false;
    }
}

// ---------- 考试导入询问弹窗 ----------
async function askImportExams() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);min-width:280px;text-align:center';
        dialog.innerHTML = `
            <div style="font-size:16px;margin-bottom:10px;font-weight:bold">是否导入考试时间</div>
            <div style="font-size:12px;color:gray;margin-bottom:20px">测试功能，周数默认为第15周，需手动调整到对应日期。出错请反馈</div>
            <div style="display:flex;justify-content:space-around">
                <button id="yesBtn" style="padding:5px 15px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer">是</button>
                <button id="noBtn" style="padding:5px 15px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer">否</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const cleanup = () => document.body.removeChild(overlay);
        dialog.querySelector('#yesBtn').onclick = () => { cleanup(); resolve(true); };
        dialog.querySelector('#noBtn').onclick = () => { cleanup(); resolve(false); };
    });
}

// ---------- 解析考试时间描述，返回星期、开始时间、结束时间 ----------
function parseExamTimeDescription(desc) {
    // 示例: "2026年05月06日 10:10-12:10(星期三第1场)"
    // 提取星期几
    const weekMap = { '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期日': 7 };
    let day = null;
    let startTime = null;
    let endTime = null;
    for (const [cn, num] of Object.entries(weekMap)) {
        if (desc.includes(cn)) {
            day = num;
            break;
        }
    }
    // 提取时间范围 HH:MM-HH:MM
    const timeMatch = desc.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
    if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2];
    }
    return { day, startTime, endTime };
}

// ---------- 获取考试数据并转换为课程格式 ----------
async function fetchExamsFromAPI(termCode) {
    const url = `https://jwxt.neu.edu.cn/jwapp/sys/homeapp/api/home/student/exams.do?termCode=${encodeURIComponent(termCode)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Fetch-Api': 'true', 'Referer': 'https://jwxt.neu.edu.cn/jwapp/sys/homeapp/home/index.html', 'User-Agent': navigator.userAgent }
    });
    if (!response.ok) throw new Error(`考试API HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== '0') throw new Error(`考试API错误码: ${data.code}`);
    const exams = data.datas || [];
    const lessons = [];
    for (const exam of exams) {
        const rawName = exam.courseName || "";
        const examType = exam.examType || "考试";
        const desc = exam.examTimeDescription || "";
        // 提取日期部分，例如 "2026年05月06日" -> "05月06日"
        let dateStr = "";
        const dateMatch = desc.match(/(\d{2})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
            dateStr = `${dateMatch[2]}月${dateMatch[3]}日`;
        } else {
            // 如果没有年份，尝试直接匹配 "05月06日"
            const simpleMatch = desc.match(/(\d{2})月(\d{2})日/);
            if (simpleMatch) dateStr = `${simpleMatch[1]}月${simpleMatch[2]}日`;
        }
        // 拼接到名称：原课程名_考试类型_日期
        const name = dateStr ? `${rawName}_${examType}_${dateStr}` : `${rawName}_${examType}`;
        const teacher = exam.teachers || "";
        const position = exam.examPlace || "";
        const { day, startTime, endTime } = parseExamTimeDescription(desc);
        if (!day || !startTime || !endTime) {
            console.warn("解析考试时间失败，跳过:", desc);
            continue;
        }
        // 固定周次为15周
        const weeks = [15];
        lessons.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: undefined,
            endSection: undefined,
            weeks: weeks,
            isCustomTime: true,
            customStartTime: startTime,
            customEndTime: endTime
        });
    }
    return lessons;
}

// ---------- API 相关函数（课表） ----------
function parseSegmentString(segment) {
    const match = segment.match(/^([\d,-\s单双]+周)/);
    if (!match) return { weeksStr: null, teacher: "", position: "" };
    let weeksStr = match[1];
    let rest = segment.substring(match[0].length).trim();
    const parts = rest.split(/\s+/);
    let teacher = "", position = "";
    if (parts.length === 1) {
        if (parts[0].includes("校区") || /[A-Za-z0-9]/.test(parts[0])) position = parts[0];
        else teacher = parts[0];
    } else if (parts.length >= 2) {
        position = parts.pop();
        teacher = parts.join(" ");
    }
    return { weeksStr, teacher, position };
}

function parseWeeksString(weeksStr) {
    if (!weeksStr) return [];
    const result = [];
    weeksStr.split(/[，,]/).forEach(part => {
        part = part.trim();
        let range = part.match(/^(\d+)-(\d+)周/);
        if (range) {
            for (let i = parseInt(range[1]); i <= parseInt(range[2]); i++) result.push(i);
        } else {
            let single = part.match(/^(\d+)周/);
            if (single) result.push(parseInt(single[1]));
        }
    });
    return [...new Set(result)].sort((a,b)=>a-b);
}

function convertApiResponseToLessons(arrangedList) {
    const lessons = [];
    for (const item of arrangedList) {
        const name = item.courseName;
        const day = item.dayOfWeek;
        const start = item.beginSection;
        const end = item.endSection;
        if (!name || !day || !start || !end) continue;
        let segments = item.titleWeekTeacherClassroomDetail || [];
        if (segments.length === 0 && item.weeksAndTeachers) {
            let fallback = item.weeksAndTeachers.replace(/\[[^\]]*\]/g, '').replace(/\//g, ' ');
            if (item.placeName && !fallback.includes(item.placeName)) fallback += ` ${item.placeName}`;
            segments = [fallback];
        }
        for (const seg of segments) {
            const { weeksStr, teacher, position } = parseSegmentString(seg);
            if (!weeksStr) continue;
            const weeks = parseWeeksString(weeksStr);
            if (weeks.length === 0) continue;
            lessons.push({
                name, teacher, position, day,
                startSection: start, endSection: end,
                weeks,
                isCustomTime: false   // 普通课表使用节次
            });
        }
    }
    return lessons;
}

async function fetchCoursesFromAPI(semesterCode, retries=2) {
    const url = 'https://jwxt.neu.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduleDetail.do';
    const xnxqdm = semesterCode;
    const xqdm = '01';
    for (let i=1; i<=retries; i++) {
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(()=>ctrl.abort(), 10000);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Fetch-Api':'true', 'Referer':'https://jwxt.neu.edu.cn/jwapp/sys/kbapp/home/index.html', 'User-Agent': navigator.userAgent, 'Accept':'application/json' },
                body: new URLSearchParams({ XNXQDM: xnxqdm, XQDM: xqdm }),
                signal: ctrl.signal
            });
            clearTimeout(tid);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.code !== '0') throw new Error(`API error ${data.code}`);
            const list = data?.datas?.getMyScheduleDetail?.arrangedList || [];
            return convertApiResponseToLessons(list);
        } catch(e) {
            if (i===retries) throw e;
            await new Promise(r=>setTimeout(r,2000));
        }
    }
}

// ---------- 保存到 Android ----------
async function SaveCourses(lessons) {
    await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(lessons));
}

async function importTimeSlotsByCampus(campus) {
    const hunNan = [{"number":1,"startTime":"08:30","endTime":"09:15"},{"number":2,"startTime":"09:25","endTime":"10:10"},{"number":3,"startTime":"10:30","endTime":"11:15"},{"number":4,"startTime":"11:25","endTime":"12:10"},{"number":5,"startTime":"14:00","endTime":"14:45"},{"number":6,"startTime":"14:55","endTime":"15:40"},{"number":7,"startTime":"16:00","endTime":"16:45"},{"number":8,"startTime":"16:55","endTime":"17:40"},{"number":9,"startTime":"18:30","endTime":"19:15"},{"number":10,"startTime":"19:25","endTime":"20:10"},{"number":11,"startTime":"20:30","endTime":"21:15"},{"number":12,"startTime":"21:15","endTime":"22:10"}];
    const nanHu = [{"number":1,"startTime":"08:00","endTime":"08:45"},{"number":2,"startTime":"08:55","endTime":"09:40"},{"number":3,"startTime":"10:00","endTime":"10:45"},{"number":4,"startTime":"10:55","endTime":"11:40"},{"number":5,"startTime":"14:00","endTime":"14:45"},{"number":6,"startTime":"14:55","endTime":"15:40"},{"number":7,"startTime":"16:00","endTime":"16:45"},{"number":8,"startTime":"16:55","endTime":"17:40"},{"number":9,"startTime":"18:30","endTime":"19:15"},{"number":10,"startTime":"19:25","endTime":"20:10"},{"number":11,"startTime":"20:20","endTime":"21:05"},{"number":12,"startTime":"21:15","endTime":"22:00"}];
    const slots = campus === "南湖校区" ? nanHu : hunNan;
    await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function SaveConfig() {
    const cfg = { semesterTotalWeeks:18, defaultClassDuration:45, defaultBreakDuration:10, firstDayOfWeek:7 };
    await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(cfg));
}

// ---------- 主流程（增加考试导入选项） ----------
async function runAllDemosSequentially() {
    AndroidBridge.showToast("开始导入课表...");
    const campus = await showCampusSelection();
    if (!campus) { AndroidBridge.showToast("已取消导入"); return; }
    const semester = await showSemesterSelection();
    if (!semester) { AndroidBridge.showToast("已取消导入"); return; }
    
    // 导入课表
    AndroidBridge.showToast("正在获取课表数据...");
    let lessons;
    try {
        lessons = await fetchCoursesFromAPI(semester);
        if (!lessons.length) { AndroidBridge.showToast("未获取到任何课程"); return; }
        console.log(`获取到 ${lessons.length} 门课程`);
    } catch(e) {
        AndroidBridge.showToast("获取课表失败: "+e.message);
        return;
    }
    await SaveCourses(lessons);
    await importTimeSlotsByCampus(campus);
    await SaveConfig();
    AndroidBridge.showToast("课表导入完成！");
    
    // 询问是否导入考试
    const importExams = await askImportExams();
    if (importExams) {
        AndroidBridge.showToast("正在获取考试数据...");
        try {
            const examLessons = await fetchExamsFromAPI(semester);
            if (examLessons.length === 0) {
                AndroidBridge.showToast("未获取到考试数据");
            } else {
                // 注意：这里会覆盖之前保存的课程（因为 SaveCourses 是覆盖保存）
                // 如果希望合并，需要修改 Android 端逻辑或单独调用另一个接口。
                // 目前简单实现：将考试数据追加到已有课程后重新保存。
                // 先获取已保存的课程？无法获取，所以我们在这里合并 lessons 和 examLessons 再保存。
                const allLessons = [...lessons, ...examLessons];
                await SaveCourses(allLessons);
                AndroidBridge.showToast(`已导入 ${examLessons.length} 条考试记录（合并至课表）`);
            }
        } catch(e) {
            AndroidBridge.showToast("导入考试失败: "+e.message);
            console.error(e);
        }
    }
    
    AndroidBridge.notifyTaskCompletion();
}

runAllDemosSequentially();