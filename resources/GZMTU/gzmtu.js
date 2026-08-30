/**
 * 拾光课程表 - 广州航海学院 (新版正方教务系统) 适配脚本
 * 课表地址：http://jwx.gzmtu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default
 */
(async function () {
    try {
        shiguangBridge.showToast("正在获取广州航海学院课表数据...");

        // 1. 获取当前页面选中的学年与学期
        let xnm = document.querySelector("#xnm")?.value || document.querySelector("select[name='xnm']")?.value;
        let xqm = document.querySelector("#xqm")?.value || document.querySelector("select[name='xqm']")?.value;

        const postData = new URLSearchParams();
        if (xnm) postData.append("xnm", xnm);
        if (xqm) postData.append("xqm", xqm);
        postData.append("kzlx", "ck");

        // 2. 请求新版正方课表数据接口
        const kbUrl = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151";
        const response = await fetch(kbUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: postData.toString()
        });

        if (!response.ok) {
            throw new Error(`网络请求异常 (HTTP ${response.status})，请确保已正常登录！`);
        }

        const data = await response.json();
        const kbList = data.kbList || [];

        if (kbList.length === 0) {
            await shiguangBridgePromise.showAlert(
                "未获取到课表",
                "当前学期暂无课程数据。如果本学期有课，请在页面下拉框切换学年学期后重试。"
            );
            return;
        }

        // 3. 周次解析工具函数
        function parseWeeks(zcd) {
            if (!zcd) return [];
            const weeks = new Set();
            const segments = zcd.split(/[,，]/);
            for (const seg of segments) {
                const match = seg.match(/(\d+)(?:-(\d+))?周?(?:\(([单双])\))?/);
                if (match) {
                    const start = parseInt(match[1], 10);
                    const end = match[2] ? parseInt(match[2], 10) : start;
                    const type = match[3];

                    for (let w = start; w <= end; w++) {
                        if (type === "单" && w % 2 === 0) continue;
                        if (type === "双" && w % 2 !== 0) continue;
                        weeks.add(w);
                    }
                }
            }
            return Array.from(weeks).sort((a, b) => a - b);
        }

        // 4. 节次解析工具函数
        function parseSection(jcor) {
            if (!jcor) return { startSection: 1, endSection: 1 };
            const parts = jcor.split("-").map(n => parseInt(n, 10)).filter(n => !isNaN(n));
            if (parts.length === 0) return { startSection: 1, endSection: 1 };
            return {
                startSection: Math.min(...parts),
                endSection: Math.max(...parts)
            };
        }

        // 5. 格式化并清洗课程数据
        const courses = [];
        for (const item of kbList) {
            const courseName = item.kcmc || item.kcmc_raw || "未命名课程";
            const teacher = item.xm || "";
            const position = item.cdmc || item.cd_id || "";
            const day = parseInt(item.xqj, 10);
            const { startSection, endSection } = parseSection(item.jcor || item.jc);
            const weeks = parseWeeks(item.zcd);

            if (weeks.length === 0 || isNaN(day)) {
                continue;
            }

            courses.push({
                name: courseName.trim(),
                teacher: teacher.trim(),
                position: position.trim(),
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks,
                isCustomTime: false,
                customStartTime: null,
                customEndTime: null,
                color: null,
                remark: item.kcxz ? `[${item.kcxz}]` : null
            });
        }

        if (courses.length === 0) {
            await shiguangBridgePromise.showAlert("解析警告", "提取到的有效课程数量为 0。");
            return;
        }

        // 6. 保存作息时间表（广州航海学院常规作息）
        const presetTimeSlots = [
            { number: 1, startTime: "08:30", endTime: "09:15", alias: "第1节" },
            { number: 2, startTime: "09:25", endTime: "10:10", alias: "第2节" },
            { number: 3, startTime: "10:30", endTime: "11:15", alias: "第3节" },
            { number: 4, startTime: "11:25", endTime: "12:10", alias: "第4节" },
            { number: 5, startTime: "14:00", endTime: "14:45", alias: "第5节" },
            { number: 6, startTime: "14:55", endTime: "15:40", alias: "第6节" },
            { number: 7, startTime: "16:00", endTime: "16:45", alias: "第7节" },
            { number: 8, startTime: "16:55", endTime: "17:40", alias: "第8节" },
            { number: 9, startTime: "19:00", endTime: "19:45", alias: "第9节" },
            { number: 10, startTime: "19:55", endTime: "20:40", alias: "第10节" },
            { number: 11, startTime: "20:50", endTime: "21:35", alias: "第11节" }
        ];
        await shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));

        // 7. 保存课程数据并通知完成
        await shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        shiguangBridge.showToast(`成功导入广州航海学院 ${courses.length} 门课程！`);
        shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("广州航海学院课表导入出错:", error);
        await shiguangBridgePromise.showAlert("导入失败", error.message || "未知错误，请重试");
    }
})();
