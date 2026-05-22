// 文件: neu.js

/**
 * 显示自定义学年学期选择对话框
 * @returns {Promise<{semesterCode: string, xnxqdm: string, xqdm: string} | null>} 
 * 返回包含学期代码的对象，若取消则返回 null
 */
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

/**
 * 显示学期选择（封装 showCustomSemesterDialog）
 * @returns {Promise<string|false>} 返回学期代码字符串，取消则返回 false
 */
async function showSemesterSelection() {
    const res = await showCustomSemesterDialog();
    return res ? res.semesterCode : false;
}

/**
 * 显示校区选择对话框（通过Android原生弹窗）
 * @returns {Promise<string|false>} 返回校区名称（"南湖校区"或"浑南校区"），取消返回 false
 */
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

/**
 * 弹窗询问用户是否导入考试时间（测试功能）
 * @returns {Promise<boolean>} true-导入，false-不导入
 */
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

/**
 * 解析考试时间描述字符串，提取星期几、开始时间、结束时间
 * @param {string} desc 例如 "2026年05月06日 10:10-12:10(星期三第1场)"
 * @returns {{day: number|null, startTime: string|null, endTime: string|null}}
 * day: 1~7 对应星期一~星期日，无法解析则为 null
 */
function parseExamTimeDescription(desc) {
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
    const timeMatch = desc.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
    if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2];
    }
    return { day, startTime, endTime };
}

/**
 * 从考试API获取指定学期的考试数据，并转换为课程对象格式
 * @param {string} termCode 学期代码，如 "2025-2026-1"
 * @returns {Promise<Array<object>>} 课程对象数组，每个对象包含 name, teacher, position, day, weeks, isCustomTime, customStartTime, customEndTime
 * @throws 网络或API错误
 */
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
        let dateStr = "";
        const dateMatch = desc.match(/(\d{2})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
            dateStr = `${dateMatch[2]}月${dateMatch[3]}日`;
        } else {
            const simpleMatch = desc.match(/(\d{2})月(\d{2})日/);
            if (simpleMatch) dateStr = `${simpleMatch[1]}月${simpleMatch[2]}日`;
        }
        const name = dateStr ? `${rawName}_${examType}_${dateStr}` : `${rawName}_${examType}`;
        const teacher = exam.teachers || "";
        const position = exam.examPlace || "";
        const { day, startTime, endTime } = parseExamTimeDescription(desc);
        if (!day || !startTime || !endTime) {
            console.warn("解析考试时间失败，跳过:", desc);
            continue;
        }
        const weeks = [15];  // 考试固定在第15周（测试功能）
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

/**
 * 增强版周次解析：支持 "1-8周", "2-6周(双)", "1,3,5周" 等格式
 * @param {string} weeksStr 周次字符串，如 "1-8周"
 * @returns {number[]} 周次数字数组（已去重、排序）
 */
function parseWeeksString(weeksStr) {
    if (!weeksStr) return [];
    const result = [];
    const weekParts = weeksStr.split(/[，,]/).map(part => part.trim());
    
    weekParts.forEach(part => {
        // 匹配单个数字周，如 "6周" 或 "6周(单)"
        const singleMatch = part.match(/^(\d+)周(?:\(([单双])\))?$/);
        if (singleMatch) {
            const num = parseInt(singleMatch[1]);
            const type = singleMatch[2];
            if (!type || (type === '单' && num % 2 === 1) || (type === '双' && num % 2 === 0)) {
                result.push(num);
            }
            return;
        }
        
        // 匹配范围周，如 "1-8周" 或 "2-6周(双)"
        const rangeMatch = part.match(/^(\d+)-(\d+)周(?:\(([单双])\))?$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            const type = rangeMatch[3];
            
            if (!type) {
                for (let i = start; i <= end; i++) result.push(i);
            } else if (type === '单') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 1) result.push(i);
                }
            } else if (type === '双') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 0) result.push(i);
                }
            }
        }
    });
    
    return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * 将API返回的课表原始数据（arrangedList）转换为标准课程对象数组
 * 新逻辑：直接从 titleDetail 解析课程名、周次、教师、地点
 * @param {Array} arrangedList API返回的课表列表
 * @returns {Array<object>} 课程对象，包含 name, teacher, position, day, startSection, endSection, weeks, isCustomTime(false)
 */
function convertApiResponseToLessons(arrangedList) {
    const lessons = [];
    for (const item of arrangedList) {
        // 必要字段检查
        const day = item.dayOfWeek;
        const startSection = item.beginSection;
        const endSection = item.endSection;
        if (!day || !startSection || !endSection) continue;

        const titleDetail = item.titleDetail;
        if (!Array.isArray(titleDetail) || titleDetail.length < 2) {
            console.warn("titleDetail 无效，跳过课程:", item);
            continue;
        }

        // 1. 课程名：从 titleDetail[0] 的第一个空格前提取
        const title0 = titleDetail[0] || "";
        const firstSpaceIdx = title0.indexOf(' ');
        const name = firstSpaceIdx !== -1 ? title0.substring(0, firstSpaceIdx) : title0;
        if (!name) continue;

        // 2. 解析 titleDetail[1]  => 周次字符串、教师、地点
        const title1 = titleDetail[1] || "";
        const tokens = title1.trim().split(/\s+/); // 按空白符分割
        if (tokens.length < 1) continue;
        const weeksStr = tokens[0];                 // 例如 "1-8周"
        const teacher = tokens[1] || "";
        // 地点：从第2个token开始到末尾，用空格重新拼接
        const position = tokens.slice(2).join(' ');

        // 3. 解析周次字符串为数字数组
        const weeks = parseWeeksString(weeksStr);
        if (weeks.length === 0) {
            console.warn(`周次解析失败: ${weeksStr}, 课程: ${name}`);
            continue;
        }

        lessons.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks,
            isCustomTime: false
        });
    }
    return lessons;
}

/**
 * 从教务API获取指定学期的课表数据（支持重试）
 * @param {string} semesterCode 学期代码，如 "2025-2026-1"
 * @param {number} retries 重试次数，默认2次
 * @returns {Promise<Array<object>>} 课程对象数组
 * @throws 网络或API错误
 */
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

/**
 * 调用Android Bridge保存课程列表（覆盖写入）
 * @param {Array<object>} lessons 课程对象数组
 */
async function SaveCourses(lessons) {
    await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(lessons));
}

/**
 * 根据校区导入预设的上下课时间表（节次时间）
 * @param {string} campus "南湖校区" 或 "浑南校区"
 */
async function importTimeSlotsByCampus(campus) {
    const hunNan = [{"number":1,"startTime":"08:30","endTime":"09:15"},{"number":2,"startTime":"09:25","endTime":"10:10"},{"number":3,"startTime":"10:30","endTime":"11:15"},{"number":4,"startTime":"11:25","endTime":"12:10"},{"number":5,"startTime":"14:00","endTime":"14:45"},{"number":6,"startTime":"14:55","endTime":"15:40"},{"number":7,"startTime":"16:00","endTime":"16:45"},{"number":8,"startTime":"16:55","endTime":"17:40"},{"number":9,"startTime":"18:30","endTime":"19:15"},{"number":10,"startTime":"19:25","endTime":"20:10"},{"number":11,"startTime":"20:30","endTime":"21:15"},{"number":12,"startTime":"21:15","endTime":"22:10"}];
    const nanHu = [{"number":1,"startTime":"08:00","endTime":"08:45"},{"number":2,"startTime":"08:55","endTime":"09:40"},{"number":3,"startTime":"10:00","endTime":"10:45"},{"number":4,"startTime":"10:55","endTime":"11:40"},{"number":5,"startTime":"14:00","endTime":"14:45"},{"number":6,"startTime":"14:55","endTime":"15:40"},{"number":7,"startTime":"16:00","endTime":"16:45"},{"number":8,"startTime":"16:55","endTime":"17:40"},{"number":9,"startTime":"18:30","endTime":"19:15"},{"number":10,"startTime":"19:25","endTime":"20:10"},{"number":11,"startTime":"20:20","endTime":"21:05"},{"number":12,"startTime":"21:15","endTime":"22:00"}];
    const slots = campus === "南湖校区" ? nanHu : hunNan;
    await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

/**
 * 保存课表全局配置（学期总周数、默认课时长度、课间休息、每周起始日）
 */
async function SaveConfig() {
    const cfg = { semesterTotalWeeks:18, defaultClassDuration:45, defaultBreakDuration:10, firstDayOfWeek:7 };
    await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(cfg));
}

/**
 * 主流程：依次选择校区、学期，获取课表，保存，可选导入考试并合并保存
 * 最后通知Android任务完成
 */
async function runAllDemosSequentially() {
    AndroidBridge.showToast("开始导入课表...");
    const campus = await showCampusSelection();
    if (!campus) { AndroidBridge.showToast("已取消导入"); return; }
    const semester = await showSemesterSelection();
    if (!semester) { AndroidBridge.showToast("已取消导入"); return; }
    
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
    
    const importExams = await askImportExams();
    if (importExams) {
        AndroidBridge.showToast("正在获取考试数据...");
        try {
            const examLessons = await fetchExamsFromAPI(semester);
            if (examLessons.length === 0) {
                AndroidBridge.showToast("未获取到考试数据");
            } else {
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

// 启动主流程
runAllDemosSequentially();