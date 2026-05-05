//拾光课程表适配JNU脚本（fetch API）
//本脚本的时间段自动导入仅适配珠海校区，其它校区可自行重新设置上课时间段

//生成年份数组
const yearArr = [];
for(let i=1990; i<=2100; i++){
    yearArr.push(i);
}

//获取本月最大日期
function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

//根据URL特征判断当前所在界面
function checkCurrentPage() {
    const currenturl = window.location.href.toLowerCase(); //获取当前URL并转为小写
    if (currenturl.includes("login?")) {
        return 1; //未登录，返回值1
    }
    if (currenturl.includes("new/index.html")) {
        return 2; //在新教务系统首页，没有进入课表，返回值2
    }
    if (currenturl.includes("jwapp/sys/wdkb")) {
        return 0; //成功登录且进入我的课表界面，返回值0
    }
    return -1; //未知错误，返回值-1
}

//显示一个公告信息弹窗
async function confirmAlert() {
    try {
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "重要提醒",
            "自动加载上课时间段仅支持珠海校区，\n每周第一天默认为星期日，可自行修改。\n是否确认获取课表？",
            "确认",
        );
        if (confirmed) {
            AndroidBridge.showToast("正在尝试导入课表...");
            return true; // 成功时返回 true
        } else {
            AndroidBridge.showToast("已取消！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        AndroidBridge.showToast("显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

//显示一个是否手动输入学年学期信息的弹窗
async function confirmGetXNXQAlert() {
    try {
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "重要提醒",
            "是否确认手动输入学年学期信息？",
            "确认",
        );
        if (confirmed) {
            return true; // 成功时返回 true
        } else {
            AndroidBridge.showToast("已取消！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        AndroidBridge.showToast("显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

//向用户获取学年信息
async function getSession() {
    try {
        const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
            "请选择学年的起始年（如2025-2026学年的2025）",
            JSON.stringify(yearArr),
            36
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < yearArr.length) {
            AndroidBridge.showToast("你选择了" + yearArr[selectedIndex] + '-' + (Number(yearArr[selectedIndex])+1) + "学年");
            return (yearArr[selectedIndex] + '-' + (Number(yearArr[selectedIndex])+1));
        } else {
            AndroidBridge.showToast("用户取消了选择！");
            return -1; // 用户取消时返回-1
        }
    } catch (error) {
        AndroidBridge.showToast("显示列表出错！" + error.message);
        return -1; // 出现错误时也返回-1
    }
}

//向用户获取学期信息
async function getSemester() {
    try {
        const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
            "请选择学期（1-第一学期，2-第二学期）",
            JSON.stringify([1,2]),
            1
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < 2) {
            if(selectedIndex === 0) {
                AndroidBridge.showToast("你选择了第一学期");
                return 1;
            }else{
                AndroidBridge.showToast("你选择了第二学期");
                return 2;
            }
        } else {
            AndroidBridge.showToast("用户取消了选择！");
            return -1; // 用户取消时返回 -1
        }
    } catch (error) {
        AndroidBridge.showToast("显示列表出错！" + error.message);
        return -1; // 出现错误时也返回 -1
    }
}

//导入预设时间段
async function importPresetTimeSlots() {
    //预设节次信息，仅适用于珠海校区
    const timeSlots = [
        {"number":1,"startTime":"08:00","endTime":"08:45"},
        {"number":2,"startTime":"08:55","endTime":"09:40"},
        {"number":3,"startTime":"10:00","endTime":"10:45"},
        {"number":4,"startTime":"10:55","endTime":"11:40"},
        {"number":5,"startTime":"12:40","endTime":"13:25"},
        {"number":6,"startTime":"13:35","endTime":"14:20"},
        {"number":7,"startTime":"14:30","endTime":"15:15"},
        {"number":8,"startTime":"15:25","endTime":"16:10"},
        {"number":9,"startTime":"16:20","endTime":"17:05"},
        {"number":10,"startTime":"17:15","endTime":"18:00"},
        {"number":11,"startTime":"19:00","endTime":"19:45"},
        {"number":12,"startTime":"19:55","endTime":"20:40"},
        {"number":13,"startTime":"20:50","endTime":"21:35"}
    ]

    try {
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        if (result === true) {
            //AndroidBridge.showToast("时间段导入成功！");
        } else {
            AndroidBridge.showToast("时间段导入失败!");
        }
    } catch (error) {
        AndroidBridge.showToast("导入时间段失败: " + error.message);
    }
}


//使用DOM方法自动获取当前课表的学年学期信息
function getSessionSemester() {
    const oriData = document.getElementById('dqxnxq2');
    if (!oriData) {
        return -1;
    }
    const xnxqID = oriData.getAttribute('value');
    if (!xnxqID) {
        return -1;
    }
    return xnxqID;
}

//使用fetch API 获取课程表信息
async function getCourses(xnxqID) {
    const fetchConfig = {
        url:'https://jw.jnu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do',
        method:'POST',
        params:{
            XNXQDM:xnxqID
        }
    }

    try {
        const response = await fetch(fetchConfig.url,
            {method:fetchConfig.method,
                headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8'},
                credentials:'include',
                body:new URLSearchParams(fetchConfig.params)});
        if (!response.ok) {
            throw new Error(`请求失败：${response.status} ${response.statusText}`);
        }
        const courseData = await response.json();
        if (courseData.datas.xskcb.totalSize === 0){
            AndroidBridge.showToast("获取到的课表为空课表，请检查学年学期信息！")
            return -1;
        }
        AndroidBridge.showToast("成功获取课程表信息，共" + courseData.datas.xskcb.totalSize + "门课程");
        return courseData;
    }catch (error){
        AndroidBridge.showToast("获取课程表失败:" + error.message);
        return -1;
    }
}

//处理原始数据中的周数，输出对应数组
function handleWeekNum(oriData){
    const result = [];
    if(oriData.includes('(')){
        const weekStr = oriData.slice(0,-4);//去掉最后四位
        const startWeek = weekStr.split('-')[0];
        const endWeek = weekStr.split('-')[1];
        if(oriData.includes('单')){
            for(let i = Number(startWeek); i<=Number(endWeek); i++){
                if(i%2 !== 0){
                    result.push(i);
                }
            }
        }else{
            for(let i = Number(startWeek); i<=Number(endWeek); i++){
                if(i%2 === 0){
                    result.push(i);
                }
            }
        }
    }else{
        const weekStr = oriData.slice(0,-1); //去掉最后一位
        const startWeek = weekStr.split('-')[0];
        const endWeek = weekStr.split('-')[1];
        for(let i = Number(startWeek); i<=Number(endWeek); i++){
            result.push(i);
        }
    }
    return result;
}

//处理原始数据中的节次信息
function handleSectionNum(oriData) {
    const result = [];
    const coursesNumStr = oriData.slice(1,-1); //去掉最后一位和第一位
    const startSection = coursesNumStr.split('-')[0];
    const endSection = coursesNumStr.split('-')[1];
    result.push(Number(startSection)); //第一位为开始节次
    result.push(Number(endSection)); //第二位为结束节次
    return result;
}

//处理原始数据中的星期信息
function handleDayNum(OriData) {
    const weekMap = [
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
        "星期日",
    ]
    for(let i=0; i<7; i++){
        if(OriData === weekMap[i])
            return i+1;
    }
    return null;
}

// 解析得到的JSON数据
function analysisCoursesInfo(oriCourseData) {
    const courses = [];
    const totalCourseNum = oriCourseData.datas.xskcb.totalSize;
    if(totalCourseNum === 0){
        return courses;
    }
    const coursesRows = oriCourseData.datas.xskcb.rows || [];
    for(let i=0; i<totalCourseNum; i++){
        const courseName = coursesRows[i].KCM ?? "未知课程";
        const teacher = coursesRows[i].SKJS ?? "未知教师";
        const position = coursesRows[i].JASMC ?? "未知地点";
        const courseTime = coursesRows[i].SKSJ.split(' '); //第一为周次，第二位为天次，第三位为节次
        const day = handleDayNum(courseTime[1]); //得到星期几上课
        const sectionInfo = {
            startSection:handleSectionNum(courseTime[2])[0], //开始节次
            endSection:handleSectionNum(courseTime[2])[1] //结束节次
        }
        const weeks = handleWeekNum(courseTime[0]);
        const courseInfo = {
            "name": courseName,        // 课程名称 (String)
            "teacher": teacher,      // 教师姓名 (String)
            "position": position,      // 上课地点 (String)
            "day": day,                 // 星期几 (Int, 1=周一, 7=周日)
            "startSection": sectionInfo.startSection,        // 开始节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
            "endSection": sectionInfo.endSection,          // 结束节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
            "weeks": weeks,    // 上课周数 (Int Array, 必须是数字数组，例如 [1, 3, 5, 7])
        }
        courses.push(courseInfo);
    }
    return courses;
}

//自动获取总星期数
function autoGetTotalWeekNum(courses) {
    let totalWeekNum = 0;
    let currentNum = 0;
    for(let i=0; i<courses.length; i++){
        currentNum = courses[i].weeks[courses[i].weeks.length-1];
        if(currentNum > totalWeekNum) {
            totalWeekNum = currentNum;
        }
    }
    return totalWeekNum;
}

//导入课程数据，同时返回得到的总星期数
async function saveCourses(courseData) {
    let xnxqID = getSessionSemester();
    if (xnxqID === -1) {
        AndroidBridge.showToast("无法自动获取学年学期信息！");
        if(await confirmGetXNXQAlert()){
            const session = await getSession();
            if(session === -1){
                return -1;
            }
            const semester = await getSemester();
            if(semester === -1){
                return -1;
            }
            xnxqID = (session + '-' + semester);
        }else {
            return -1;
        }
    }else{
        AndroidBridge.showToast("自动获取到学年学期信息：" + xnxqID);
    }

    const rawResponse = await getCourses(xnxqID);
    if(rawResponse === -1) {
        return -1;
    }

    const courses = analysisCoursesInfo(rawResponse);
    const totalWeeksNum = autoGetTotalWeekNum(courses);

    try {
        const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            //AndroidBridge.showToast("课程导入成功！");
            return totalWeeksNum;
        } else {
            AndroidBridge.showToast("课程导入失败!");
            return -1
        }
    } catch (error) {
        AndroidBridge.showToast("导入课程失败: " + error.message);
        return -1;
    }

}

//导入课表配置
async function saveConfig(semesterTotalWeeks) {
    // 注意：只传入要修改的字段，其他字段（如 semesterTotalWeeks）会使用 Kotlin 模型中的默认值
    let semesterStartData = "";
    let choseResult = 1;

    //显示三次单项选择框，向用户获取开学时间
    try {
        const yearIndex = await window.AndroidBridgePromise.showSingleSelection(
            "请选择开学时间（年份）",
            JSON.stringify(yearArr),
            36
        );
        if (yearIndex !== null && yearIndex >= 0 && yearIndex < yearArr.length) {
            const year = yearArr[yearIndex];
            const monthIndex = await window.AndroidBridgePromise.showSingleSelection(
                "请选择开学时间（月份）",
                JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12]),
                2
            );
            if (monthIndex !== null && monthIndex >= 0 && monthIndex < 12) {
                const month =[1,2,3,4,5,6,7,8,9,10,11,12][monthIndex];
                const dayArr = [];
                for (let i = 1; i <= getDaysInMonth(year,month); i++) {
                    dayArr.push(i);
                }
                const dayIndex = await window.AndroidBridgePromise.showSingleSelection(
                    "请选择开学时间（日期）",
                    JSON.stringify(dayArr),
                    7
                );
                if (dayIndex !== null && dayIndex >= 0 && dayIndex < dayArr.length) {
                    const day = dayArr[dayIndex];
                    const yearStr = year.toString();
                    const monthStr = month.toString().padStart(2,"0"); //补充为两位
                    const dayStr = day.toString().padStart(2,"0"); //补充为两位
                    semesterStartData =  yearStr + '-' + monthStr + '-' + dayStr;
                    AndroidBridge.showToast("你选择的开学时间为：" + semesterStartData);
                } else {
                    choseResult = 0;
                }
            } else {
                choseResult = 0;
            }
        } else {
            choseResult = 0;
        }
    } catch (error) {
        AndroidBridge.showToast("显示列表出错！" + error.message);
        return -1; // 出现错误时也返回 -1
    }

    if(!choseResult){
        AndroidBridge.showToast("用户取消了选择，将按默认开学日期2026-3-9导入配置");
        semesterStartData = "2026-03-09";
    }



    try {
        const courseConfigData = {
            "semesterStartDate": semesterStartData, //月份要使用两位数，否则软件会崩溃
            "semesterTotalWeeks": Number(semesterTotalWeeks),
            "defaultClassDuration": 45,
            "defaultBreakDuration": 10,
            "firstDayOfWeek": 7
        };
        const configJsonString = JSON.stringify(courseConfigData);
        const result = await window.AndroidBridgePromise.saveCourseConfig(configJsonString);
        if (result === true) {
            return 0;
            //AndroidBridge.showToast("课表配置导入成功！");
        } else {
            AndroidBridge.showToast("课表配置导入失败");
            return -1;
        }
    } catch (error) {
        AndroidBridge.showToast("导入配置失败: " + error.message);
        return -1;
    }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runAllDemosSequentially() {
    //检查是否进入课表界面
    const currentPageNum = checkCurrentPage();
    if(currentPageNum === 1){
        AndroidBridge.showToast("请登录教务系统");
        return;
    }else if(currentPageNum === 2) {
        AndroidBridge.showToast("请进入我的课表界面");
        return;
    }else if(currentPageNum === -1) {
        AndroidBridge.showToast("未知错误");
        return;
    }

    //确认窗口
    const alertResult = await confirmAlert();
    if (!alertResult) {
        return; // 用户取消，立即退出函数
    }

    const totalNum = await saveCourses();
    if(totalNum === -1) {
        return;
    }
    await importPresetTimeSlots();
    const saveConfigResult = await saveConfig(totalNum);
    if(saveConfigResult === -1)
    {
        return;
    }

    // 发送最终的生命周期完成信号
    AndroidBridge.notifyTaskCompletion();
}

runAllDemosSequentially();
