// Google Apps Script 代码 - 网站访问统计系统（每日独立表格版本）
// 主控制表格 ID: 1HXeP12yjeI7_MqC3FQr9viDadweL3uVq2NPaeMxJs7Q
// 
// 架构说明：
// - 主表格：用于控制台、统计汇总、表格索引
// - 每日表格：每天自动创建新的独立表格，包含当天的详细数据和广告引导数据
// - 表格命名：ads-ZF-2025-01-15
// - 文件夹：所有每日表格存放在"网站统计数据"文件夹中

// ==================== 配置常量 ====================

const MAIN_SPREADSHEET_ID = '1HXeP12yjeI7_MqC3FQr9viDadweL3uVq2NPaeMxJs7Q';
const DATA_FOLDER_NAME = '网站统计数据';
const SPREADSHEET_PREFIX = 'ads-ZF-';

// ==================== 主入口函数 ====================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const eventType = data.eventType || 'page_visit';
    
    // 获取或创建今日表格
    const dateString = getDateString();
    const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
    
    if (eventType === 'ad_guide_triggered') {
      handleAdGuideEvent(dailySpreadsheet, data);
    } else if (eventType === 'ad_click') {
      handleAdClickEvent(dailySpreadsheet, data);
    } else if (eventType === 'protection_activated' || 
               eventType === 'protection_active' ||
               eventType === 'overlay_clicked' || 
               eventType === 'user_confirmed_yes' || 
               eventType === 'user_confirmed_no' || 
               eventType === 'protection_ended') {
      handleProtectionEvent(dailySpreadsheet, data);
    } else {
      handlePageVisitEvent(dailySpreadsheet, data);
    }
    
    // 1%概率更新主控制台统计
    if (Math.random() < 0.01) {
      updateMainDashboard();
    }
    
    // 0.5%概率自动清理重复索引（平均每200次请求清理一次）
    if (Math.random() < 0.005) {
      cleanupDuplicateIndexRecords();
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error('Error:', error);
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput('Analytics endpoint is working! (Daily Spreadsheets Version)').setMimeType(ContentService.MimeType.TEXT);
}

// ==================== 表格管理核心函数 ====================

/**
 * 获取或创建每日独立表格（带并发锁保护）
 * @param {string} dateString - 日期字符串（格式：2025-01-15）
 * @return {Spreadsheet} 每日表格对象
 */
function getOrCreateDailySpreadsheet(dateString) {
  const spreadsheetName = SPREADSHEET_PREFIX + dateString;
  
  // 1. 先快速查找索引（无锁）
  const mainSpreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
  const indexSheet = getOrCreateIndexSheet(mainSpreadsheet);
  let spreadsheetId = findSpreadsheetIdFromIndex(indexSheet, dateString);
  
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      console.log('索引中的表格ID无效，将重新查找');
    }
  }
  
  // 2. 获取锁，防止并发创建（最多等待10秒）
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    
    // 再次检查索引（可能其他线程已创建）
    spreadsheetId = findSpreadsheetIdFromIndex(indexSheet, dateString);
    if (spreadsheetId) {
      try {
        lock.releaseLock();
        return SpreadsheetApp.openById(spreadsheetId);
      } catch (e) {
        console.log('索引中的表格ID无效');
      }
    }
    
    // 3. 搜索文件夹中是否存在同名表格（关键：防止创建重复文件）
    const folder = getOrCreateDataFolder();
    const files = folder.getFilesByName(spreadsheetName);
    
    if (files.hasNext()) {
      const file = files.next();
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      // 找到文件后添加到索引（允许重复索引，不影响数据）
      addToIndex(indexSheet, dateString, file.getId(), file.getUrl());
      lock.releaseLock();
      return spreadsheet;
    }
    
    // 4. 创建新的每日表格
    const newSpreadsheet = SpreadsheetApp.create(spreadsheetName);
    const newFile = DriveApp.getFileById(newSpreadsheet.getId());
    
    // 移动到指定文件夹
    folder.addFile(newFile);
    DriveApp.getRootFolder().removeFile(newFile);
    
    // 初始化表格结构
    initializeDailySpreadsheet(newSpreadsheet, dateString);
    
    // 添加到索引（允许重复索引，不影响数据）
    addToIndex(indexSheet, dateString, newSpreadsheet.getId(), newSpreadsheet.getUrl());
    
    lock.releaseLock();
    return newSpreadsheet;
    
  } catch (e) {
    console.error('获取锁失败:', e);
    // 如果获取锁失败，尝试直接从文件夹查找
    const folder = getOrCreateDataFolder();
    const files = folder.getFilesByName(spreadsheetName);
    if (files.hasNext()) {
      return SpreadsheetApp.openById(files.next().getId());
    }
    throw new Error('无法创建或获取每日表格');
  }
}

/**
 * 初始化每日表格的基本结构
 */
function initializeDailySpreadsheet(spreadsheet, dateString) {
  // 删除默认的Sheet1
  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet) {
    spreadsheet.deleteSheet(defaultSheet);
  }
  
  // 创建"页面访问"sheet
  const visitSheet = spreadsheet.insertSheet('页面访问');
  visitSheet.getRange(1, 1, 1, 4).setValues([
    ['时间', '访问页面', '用户属性', 'IP地址']
  ]);
  const visitHeader = visitSheet.getRange(1, 1, 1, 4);
  visitHeader.setBackground('#4285f4').setFontColor('white').setFontWeight('bold');
  visitSheet.setColumnWidth(1, 150);
  visitSheet.setColumnWidth(2, 300);
  visitSheet.setColumnWidth(3, 200);
  visitSheet.setColumnWidth(4, 120);
  
  // 创建"广告引导"sheet
  const adGuideSheet = spreadsheet.insertSheet('广告引导');
  adGuideSheet.getRange(1, 1, 1, 9).setValues([
    ['时间', '访问页面', '用户属性', 'IP地址', '累计广告数', '当前页广告数', '触发次数', '最大触发次数', '事件时间戳']
  ]);
  const adGuideHeader = adGuideSheet.getRange(1, 1, 1, 9);
  adGuideHeader.setBackground('#FF6B6B').setFontColor('white').setFontWeight('bold');
  adGuideSheet.setColumnWidth(1, 150);
  adGuideSheet.setColumnWidth(2, 300);
  adGuideSheet.setColumnWidth(3, 200);
  adGuideSheet.setColumnWidth(4, 120);
  adGuideSheet.setColumnWidth(5, 100);
  adGuideSheet.setColumnWidth(6, 120);
  adGuideSheet.setColumnWidth(7, 100);
  adGuideSheet.setColumnWidth(8, 120);
  adGuideSheet.setColumnWidth(9, 180);
  
  // 创建"广告点击"sheet
  const adClickSheet = spreadsheet.insertSheet('广告点击');
  adClickSheet.getRange(1, 1, 1, 17).setValues([
    ['时间', '小说标题', '章节号', '页面URL', '广告位ID', '广告位置(px)', '滚动深度', '用户IP', '设备类型', '屏幕尺寸', '停留时长(秒)', '历史累计点击', '来源参数', '点击来源', '保护状态', '保护期点击', '保护剩余时间']
  ]);
  const adClickHeader = adClickSheet.getRange(1, 1, 1, 17);
  adClickHeader.setBackground('#34A853').setFontColor('white').setFontWeight('bold');
  adClickSheet.setColumnWidth(1, 150);   // 时间
  adClickSheet.setColumnWidth(2, 200);   // 小说标题
  adClickSheet.setColumnWidth(3, 80);    // 章节号
  adClickSheet.setColumnWidth(4, 300);   // 页面URL
  adClickSheet.setColumnWidth(5, 120);   // 广告位ID
  adClickSheet.setColumnWidth(6, 100);   // 广告位置
  adClickSheet.setColumnWidth(7, 100);   // 滚动深度
  adClickSheet.setColumnWidth(8, 120);   // IP地址
  adClickSheet.setColumnWidth(9, 100);   // 设备类型
  adClickSheet.setColumnWidth(10, 120);  // 屏幕尺寸
  adClickSheet.setColumnWidth(11, 100);  // 停留时长
  adClickSheet.setColumnWidth(12, 120);  // 历史累计点击
  adClickSheet.setColumnWidth(13, 200);  // 来源参数
  adClickSheet.setColumnWidth(14, 120);  // 点击来源
  adClickSheet.setColumnWidth(15, 100);  // 保护状态
  adClickSheet.setColumnWidth(16, 100);  // 保护期点击
  adClickSheet.setColumnWidth(17, 120);  // 保护剩余时间
  
  // 创建"防误触遮罩"sheet
  const protectionSheet = spreadsheet.insertSheet('防误触遮罩');
  protectionSheet.getRange(1, 1, 1, 14).setValues([
    ['时间', '事件类型', '小说标题', '章节号', '页面URL', '广告位ID', 
     '用户IP', '用户代理', '屏幕尺寸', '10次点击时长(秒)', '保护剩余时间(秒)', 
     '保护期点击次数', '确认结果', '事件时间戳']
  ]);
  const protectionHeader = protectionSheet.getRange(1, 1, 1, 14);
  protectionHeader.setBackground('#FF9800').setFontColor('white').setFontWeight('bold');
  protectionSheet.setColumnWidth(1, 150);   // 时间
  protectionSheet.setColumnWidth(2, 150);   // 事件类型
  protectionSheet.setColumnWidth(3, 200);   // 小说标题
  protectionSheet.setColumnWidth(4, 80);    // 章节号
  protectionSheet.setColumnWidth(5, 300);   // 页面URL
  protectionSheet.setColumnWidth(6, 120);   // 广告位ID
  protectionSheet.setColumnWidth(7, 120);   // 用户IP
  protectionSheet.setColumnWidth(8, 250);   // 用户代理
  protectionSheet.setColumnWidth(9, 100);   // 屏幕尺寸
  protectionSheet.setColumnWidth(10, 150);  // 10次点击时长
  protectionSheet.setColumnWidth(11, 150);  // 保护剩余时间
  protectionSheet.setColumnWidth(12, 120);  // 保护期点击次数
  protectionSheet.setColumnWidth(13, 100);  // 确认结果
  protectionSheet.setColumnWidth(14, 180);  // 事件时间戳
  
  // 创建"当日统计"概览sheet
  const summarySheet = spreadsheet.insertSheet('📊当日统计', 0);
  initializeDailySummary(summarySheet, dateString);
}

/**
 * 初始化当日统计概览
 */
function initializeDailySummary(sheet, dateString) {
  sheet.getRange(1, 1, 1, 3).merge();
  sheet.getRange(1, 1).setValue(`📊 ${dateString} 访问统计概览`);
  sheet.getRange(1, 1).setBackground('#1a73e8').setFontColor('white').setFontSize(14).setFontWeight('bold');
  
  const headers = [
    ['统计项目', '数值', '说明'],
    ['页面访问次数', 0, '当天的总访问次数'],
    ['广告点击次数', 0, '当天的广告点击次数'],
    ['广告引导触发', 0, '广告引导弹窗触发次数'],
    ['独立IP数量', 0, '去重后的访问IP数量'],
    ['最后更新时间', '', '数据最后更新的时间']
  ];
  
  sheet.getRange(2, 1, headers.length, 3).setValues(headers);
  sheet.getRange(2, 1, 1, 3).setBackground('#4285f4').setFontColor('white').setFontWeight('bold');
  
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 250);
}

/**
 * 获取或创建数据文件夹
 */
function getOrCreateDataFolder() {
  const folders = DriveApp.getFoldersByName(DATA_FOLDER_NAME);
  
  if (folders.hasNext()) {
    return folders.next();
  }
  
  return DriveApp.createFolder(DATA_FOLDER_NAME);
}

/**
 * 获取或创建主表格的索引sheet
 */
function getOrCreateIndexSheet(mainSpreadsheet) {
  let indexSheet = mainSpreadsheet.getSheetByName('📑表格索引');
  
  if (!indexSheet) {
    indexSheet = mainSpreadsheet.insertSheet('📑表格索引', 0);
    
    // 设置表头
    indexSheet.getRange(1, 1, 1, 4).setValues([
      ['日期', '表格ID', '表格链接', '创建时间']
    ]);
    indexSheet.getRange(1, 1, 1, 4).setBackground('#34a853').setFontColor('white').setFontWeight('bold');
    
    indexSheet.setColumnWidth(1, 120);
    indexSheet.setColumnWidth(2, 300);
    indexSheet.setColumnWidth(3, 400);
    indexSheet.setColumnWidth(4, 180);
  }
  
  return indexSheet;
}

/**
 * 从索引中查找表格ID
 */
function findSpreadsheetIdFromIndex(indexSheet, dateString) {
  const data = indexSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dateString) {
      return data[i][1];
    }
  }
  
  return null;
}

/**
 * 添加表格到索引（简单添加，允许重复）
 */
function addToIndex(indexSheet, dateString, spreadsheetId, spreadsheetUrl) {
  // 简单添加，不做复杂检查
  // 重复索引不影响数据收集，只是显示上有重复，可以定期清理
  const newRow = [
    dateString,
    spreadsheetId,
    spreadsheetUrl,
    getTimeString()
  ];
  
  indexSheet.appendRow(newRow);
  console.log(`添加索引: ${dateString} -> ${spreadsheetId}`);
}

// ==================== 数据写入函数 ====================

/**
 * 处理页面访问事件
 */
function handlePageVisitEvent(dailySpreadsheet, data) {
  const visitSheet = dailySpreadsheet.getSheetByName('页面访问');
  
  if (!visitSheet) {
    console.error('页面访问sheet不存在！');
    return;
  }
  
  const rowData = [
    getTimeString(),              // 时间
    data.page || '',              // 访问页面
    data.userAgent || '',         // 用户属性
    data.userIP || 'Unknown'      // IP地址
  ];
  
  visitSheet.appendRow(rowData);
  
  // 5%概率更新当日统计
  if (Math.random() < 0.05) {
    updateDailySummary(dailySpreadsheet);
  }
}

/**
 * 处理广告引导事件
 */
function handleAdGuideEvent(dailySpreadsheet, data) {
  const adGuideSheet = dailySpreadsheet.getSheetByName('广告引导');
  
  if (!adGuideSheet) {
    console.error('广告引导sheet不存在！');
    return;
  }
  
  const rowData = [
    getTimeString(),
    data.page || '',
    data.userAgent || '',
    data.userIP || 'Unknown',
    data.totalAdsSeen || 0,
    data.currentPageAds || 0,
    data.triggerCount || 0,
    data.maxTriggers || 3,
    data.timestamp || ''
  ];
  
  adGuideSheet.appendRow(rowData);
}

/**
 * 处理广告点击事件
 */
function handleAdClickEvent(dailySpreadsheet, data) {
  // 确保广告点击工作表存在
  let adClickSheet = dailySpreadsheet.getSheetByName('广告点击');
  
  if (!adClickSheet) {
    console.log('广告点击工作表不存在，正在创建...');
    adClickSheet = addAdClickSheetToExisting(dailySpreadsheet);
  }
  
  // 解析设备信息
  const deviceType = getDeviceType(data.userAgent);
  
  // 提取来源参数
  const sourceParams = extractSourceParams(data.pageUrl);
  
  // 格式化保护剩余时间
  const protectionRemainingFormatted = formatProtectionTime(data.protectionRemaining || 0);
  
  const rowData = [
    getTimeString(),                    // 时间
    data.novel || '',                   // 小说标题
    data.chapter || '',                 // 章节号
    data.pageUrl || '',                 // 页面URL
    data.adSlot || '',                  // 广告位ID
    data.adPosition || '',              // 广告位置(px)
    data.scrollDepth || '',             // 滚动深度
    data.userIP || 'Unknown',           // IP地址
    deviceType,                         // 设备类型
    data.screenSize || '',              // 屏幕尺寸
    data.stayDuration || 0,             // 停留时长(秒)
    data.totalClickCount || 0,          // 历史累计点击次数
    sourceParams,                       // 来源参数
    data.clickSource || 'normal',       // 点击来源
    data.protectionActive ? '是' : '否', // 保护状态
    data.clicksInProtection || 0,       // 保护期内点击
    protectionRemainingFormatted        // 保护剩余时间
  ];
  
  adClickSheet.appendRow(rowData);
  
  // 5%概率更新当日统计
  if (Math.random() < 0.05) {
    updateDailySummary(dailySpreadsheet);
  }
}

/**
 * 处理防误触遮罩事件
 */
function handleProtectionEvent(dailySpreadsheet, data) {
  let protectionSheet = dailySpreadsheet.getSheetByName('防误触遮罩');
  
  if (!protectionSheet) {
    console.log('防误触遮罩工作表不存在，正在创建...');
    protectionSheet = addProtectionSheetToExisting(dailySpreadsheet);
  }
  
  // 格式化时长
  const clickTimeSpan = data.clickTimeSpan ? Math.round(data.clickTimeSpan) + 's' : '';
  const protectionRemaining = data.protectionRemaining ? Math.round(data.protectionRemaining / 1000) + 's' : '';
  
  const rowData = [
    getTimeString(),                    // 时间
    data.eventType || '',               // 事件类型
    data.novel || '',                   // 小说标题
    data.chapter || '',                 // 章节号
    data.pageUrl || '',                 // 页面URL
    data.adSlot || '',                  // 广告位ID
    data.userIP || 'Unknown',           // 用户IP
    data.userAgent || '',               // 用户代理
    data.screenSize || '',              // 屏幕尺寸
    clickTimeSpan,                      // 10次点击时长
    protectionRemaining,                // 保护剩余时间
    data.clicksInProtection || 0,       // 保护期点击次数
    data.confirmResult || '',           // 确认结果
    data.timestamp || ''                // 事件时间戳
  ];
  
  protectionSheet.appendRow(rowData);
}

/**
 * 为现有表格添加"防误触遮罩"工作表（如果不存在）
 */
function addProtectionSheetToExisting(spreadsheet) {
  let protectionSheet = spreadsheet.getSheetByName('防误触遮罩');
  
  if (protectionSheet) {
    console.log('防误触遮罩工作表已存在');
    return protectionSheet;
  }
  
  protectionSheet = spreadsheet.insertSheet('防误触遮罩');
  protectionSheet.getRange(1, 1, 1, 14).setValues([
    ['时间', '事件类型', '小说标题', '章节号', '页面URL', '广告位ID', 
     '用户IP', '用户代理', '屏幕尺寸', '10次点击时长(秒)', '保护剩余时间(秒)', 
     '保护期点击次数', '确认结果', '事件时间戳']
  ]);
  
  const protectionHeader = protectionSheet.getRange(1, 1, 1, 14);
  protectionHeader.setBackground('#FF9800').setFontColor('white').setFontWeight('bold');
  
  protectionSheet.setColumnWidth(1, 150);
  protectionSheet.setColumnWidth(2, 150);
  protectionSheet.setColumnWidth(3, 200);
  protectionSheet.setColumnWidth(4, 80);
  protectionSheet.setColumnWidth(5, 300);
  protectionSheet.setColumnWidth(6, 120);
  protectionSheet.setColumnWidth(7, 120);
  protectionSheet.setColumnWidth(8, 250);
  protectionSheet.setColumnWidth(9, 100);
  protectionSheet.setColumnWidth(10, 150);
  protectionSheet.setColumnWidth(11, 150);
  protectionSheet.setColumnWidth(12, 120);
  protectionSheet.setColumnWidth(13, 100);
  protectionSheet.setColumnWidth(14, 180);
  
  console.log('成功创建防误触遮罩工作表');
  return protectionSheet;
}

// ==================== 统计更新函数 ====================

/**
 * 更新每日表格的统计概览
 */
function updateDailySummary(dailySpreadsheet) {
  try {
    const summarySheet = dailySpreadsheet.getSheetByName('📊当日统计');
    if (!summarySheet) return;
    
    // 统计页面访问
    const visitSheet = dailySpreadsheet.getSheetByName('页面访问');
    const visitCount = visitSheet ? Math.max(0, visitSheet.getDataRange().getNumRows() - 1) : 0;
    
    // 统计广告引导
    const adGuideSheet = dailySpreadsheet.getSheetByName('广告引导');
    const adGuideCount = adGuideSheet ? Math.max(0, adGuideSheet.getDataRange().getNumRows() - 1) : 0;
    
    // 统计广告点击
    const adClickSheet = dailySpreadsheet.getSheetByName('广告点击');
    const adClickCount = adClickSheet ? Math.max(0, adClickSheet.getDataRange().getNumRows() - 1) : 0;
    
    // 统计独立IP
    let uniqueIPs = 0;
    if (visitSheet && visitCount > 0) {
      const ipData = visitSheet.getRange(2, 4, visitCount, 1).getValues();
      const ipSet = new Set();
      ipData.forEach(row => {
        const ip = row[0];
        if (ip && ip !== 'Unknown' && ip !== 'Error') {
          ipSet.add(ip);
        }
      });
      uniqueIPs = ipSet.size;
    }
    
    // 更新数据
    summarySheet.getRange(3, 2).setValue(visitCount);
    summarySheet.getRange(4, 2).setValue(adClickCount);
    summarySheet.getRange(5, 2).setValue(adGuideCount);
    summarySheet.getRange(6, 2).setValue(uniqueIPs);
    summarySheet.getRange(7, 2).setValue(getTimeString());
  } catch (error) {
    console.error('更新每日统计失败:', error);
  }
}

/**
 * 更新主控制台（汇总所有表格的统计）
 */
function updateMainDashboard() {
  try {
    const mainSpreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    
    let dashboardSheet = mainSpreadsheet.getSheetByName('📊总控制台');
    if (!dashboardSheet) {
      dashboardSheet = mainSpreadsheet.insertSheet('📊总控制台', 0);
      initializeMainDashboard(dashboardSheet);
    }
    
    // 获取索引sheet
    const indexSheet = mainSpreadsheet.getSheetByName('📑表格索引');
    if (!indexSheet) return;
    
    // 统计所有表格
    const indexData = indexSheet.getDataRange().getValues();
    let totalVisits = 0;
    let totalAdGuides = 0;
    let totalAdClicks = 0;
    let activeDays = 0;
    let todayVisits = 0;
    
    const today = getDateString();
    
    for (let i = 1; i < indexData.length; i++) {
      const dateString = indexData[i][0];
      const spreadsheetId = indexData[i][1];
      
      if (!spreadsheetId) continue;
      
      try {
        const dailySpreadsheet = SpreadsheetApp.openById(spreadsheetId);
        const visitSheet = dailySpreadsheet.getSheetByName('页面访问');
        const adGuideSheet = dailySpreadsheet.getSheetByName('广告引导');
        const adClickSheet = dailySpreadsheet.getSheetByName('广告点击');
        
        if (visitSheet) {
          const visitCount = Math.max(0, visitSheet.getDataRange().getNumRows() - 1);
          totalVisits += visitCount;
          
          if (visitCount > 0) activeDays++;
          if (dateString === today) todayVisits = visitCount;
        }
        
        if (adGuideSheet) {
          totalAdGuides += Math.max(0, adGuideSheet.getDataRange().getNumRows() - 1);
        }
        
        if (adClickSheet) {
          totalAdClicks += Math.max(0, adClickSheet.getDataRange().getNumRows() - 1);
        }
      } catch (e) {
        console.log(`无法打开表格 ${spreadsheetId}`);
      }
    }
    
    // 更新控制台数据
    dashboardSheet.getRange(3, 2).setValue(todayVisits);
    dashboardSheet.getRange(4, 2).setValue(totalVisits);
    dashboardSheet.getRange(5, 2).setValue(totalAdClicks);
    dashboardSheet.getRange(6, 2).setValue(totalAdGuides);
    dashboardSheet.getRange(7, 2).setValue(activeDays);
    dashboardSheet.getRange(8, 2).setValue(activeDays > 0 ? Math.round(totalVisits / activeDays) : 0);
    
    const updateTime = getTimeString();
    dashboardSheet.getRange(3, 3).setValue(updateTime);
    dashboardSheet.getRange(4, 3).setValue(updateTime);
  } catch (error) {
    console.error('更新主控制台失败:', error);
  }
}

/**
 * 初始化主控制台
 */
function initializeMainDashboard(sheet) {
  sheet.getRange(1, 1, 1, 4).merge();
  sheet.getRange(1, 1).setValue('📊 网站访问统计总控制台');
  sheet.getRange(1, 1).setBackground('#1a73e8').setFontColor('white').setFontSize(14).setFontWeight('bold');
  
  const headers = [
    ['统计项目', '数值', '最后更新', '说明'],
    ['今日访问量', 0, '', '今天的访问次数'],
    ['总访问量', 0, '', '所有记录的总访问量'],
    ['总广告点击', 0, '', '所有广告点击次数'],
    ['总广告引导', 0, '', '所有广告引导触发次数'],
    ['活跃天数', 0, '', '有访问记录的天数'],
    ['平均日访问', 0, '', '每日平均访问量']
  ];
  
  sheet.getRange(2, 1, headers.length, 4).setValues(headers);
  sheet.getRange(2, 1, 1, 4).setBackground('#4285f4').setFontColor('white').setFontWeight('bold');
  
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 250);
}

// ==================== 工具函数 ====================

function getDateString() {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-');
}

function getTimeString() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// ==================== 测试和手动触发函数 ====================

function testCreateDailySpreadsheet() {
  const dateString = getDateString();
  const spreadsheet = getOrCreateDailySpreadsheet(dateString);
  return '测试成功！表格URL: ' + spreadsheet.getUrl();
}

function manualUpdateDashboard() {
  updateMainDashboard();
  return '主控制台更新完成';
}

/**
 * 定期清理索引中的重复记录（按表格ID去重，每个表格ID只保留第一条）
 * 自动运行：0.5%概率（平均每200次请求清理一次）
 */
function cleanupDuplicateIndexRecords() {
  try {
    const mainSpreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const indexSheet = mainSpreadsheet.getSheetByName('📑表格索引');
    
    if (!indexSheet) {
      console.log('找不到索引表');
      return '找不到索引表';
    }
    
    const data = indexSheet.getDataRange().getValues();
    const seen = new Map(); // 表格ID -> 第一次出现的行号
    const rowsToDelete = [];
    
    // 从第1行开始检查（兼容有无表头的情况）
    for (let i = 0; i < data.length; i++) {
      const dateString = data[i][0];
      const spreadsheetId = data[i][1]; // 第2列是表格ID
      
      // 跳过表头行（包含"日期"或"表格ID"文字的）
      if (dateString === '日期' || dateString === 'Date' || spreadsheetId === '表格ID') {
        continue;
      }
      
      // 跳过空行
      if (!spreadsheetId) {
        rowsToDelete.push(i + 1);
        continue;
      }
      
      if (seen.has(spreadsheetId)) {
        // 已经有这个表格ID了，标记删除
        rowsToDelete.push(i + 1);
        console.log(`发现重复表格ID: ${spreadsheetId} (日期:${dateString}, 行${i + 1})`);
      } else {
        // 第一次见到这个表格ID，保留
        seen.set(spreadsheetId, i + 1);
      }
    }
    
    // 从后往前删除（避免行号变化）
    rowsToDelete.reverse();
    let deletedCount = 0;
    for (const row of rowsToDelete) {
      try {
        indexSheet.deleteRow(row);
        deletedCount++;
      } catch (e) {
        console.error(`删除行${row}失败:`, e);
      }
    }
    
    const message = `清理完成！删除了 ${deletedCount} 条重复索引（按表格ID去重），保留了 ${seen.size} 条唯一表格`;
    console.log(message);
    return message;
    
  } catch (error) {
    console.error('清理索引失败:', error);
    return '清理失败: ' + error.toString();
  }
}

/**
 * 手动立即清理重复索引（处理大量重复时使用）
 */
function manualCleanupDuplicates() {
  return cleanupDuplicateIndexRecords();
}

function testPageVisit() {
  const testData = {
    eventType: 'page_visit',
    page: 'https://re.cankalp.com/novels/test/chapter-1',
    userAgent: 'Mozilla/5.0 (iPhone; Test)',
    referrer: 'https://re.cankalp.com/novels/test/index',
    userIP: '127.0.0.1'
  };
  
  const dateString = getDateString();
  const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
  handlePageVisitEvent(dailySpreadsheet, testData);
  
  return '测试数据已写入: ' + dailySpreadsheet.getUrl();
}

function testAdGuide() {
  const testData = {
    eventType: 'ad_guide_triggered',
    page: 'https://novel.fkens.top/novels/test/chapter-1',
    userAgent: 'Mozilla/5.0 (iPhone; Test)',
    referrer: 'https://novel.fkens.top/novels/test/index',
    userIP: '127.0.0.1',
    totalAdsSeen: 15,
    currentPageAds: 3,
    triggerCount: 2,
    maxTriggers: 3,
    timestamp: new Date().toISOString()
  };
  
  const dateString = getDateString();
  const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
  handleAdGuideEvent(dailySpreadsheet, testData);
  
  return '测试数据已写入: ' + dailySpreadsheet.getUrl();
}

/**
 * 为现有的每日表格添加"广告点击"工作表（如果不存在）
 */
function addAdClickSheetToExisting(spreadsheet) {
  let adClickSheet = spreadsheet.getSheetByName('广告点击');
  
  if (adClickSheet) {
    console.log('广告点击工作表已存在');
    return adClickSheet;
  }
  
  // 创建新的广告点击工作表
  adClickSheet = spreadsheet.insertSheet('广告点击');
  adClickSheet.getRange(1, 1, 1, 17).setValues([
    ['时间', '小说标题', '章节号', '页面URL', '广告位ID', '广告位置(px)', '滚动深度', '用户IP', '设备类型', '屏幕尺寸', '停留时长(秒)', '历史累计点击', '来源参数', '点击来源', '保护状态', '保护期点击', '保护剩余时间']
  ]);
  
  const adClickHeader = adClickSheet.getRange(1, 1, 1, 17);
  adClickHeader.setBackground('#34A853').setFontColor('white').setFontWeight('bold');
  
  adClickSheet.setColumnWidth(1, 150);   // 时间
  adClickSheet.setColumnWidth(2, 200);   // 小说标题
  adClickSheet.setColumnWidth(3, 80);    // 章节号
  adClickSheet.setColumnWidth(4, 300);   // 页面URL
  adClickSheet.setColumnWidth(5, 120);   // 广告位ID
  adClickSheet.setColumnWidth(6, 100);   // 广告位置
  adClickSheet.setColumnWidth(7, 100);   // 滚动深度
  adClickSheet.setColumnWidth(8, 120);   // IP地址
  adClickSheet.setColumnWidth(9, 100);   // 设备类型
  adClickSheet.setColumnWidth(10, 120);  // 屏幕尺寸
  adClickSheet.setColumnWidth(11, 100);  // 停留时长
  adClickSheet.setColumnWidth(12, 120);  // 历史累计点击
  adClickSheet.setColumnWidth(13, 200);  // 来源参数
  adClickSheet.setColumnWidth(14, 120);  // 点击来源
  adClickSheet.setColumnWidth(15, 100);  // 保护状态
  adClickSheet.setColumnWidth(16, 100);  // 保护期点击
  adClickSheet.setColumnWidth(17, 120);  // 保护剩余时间
  
  console.log('成功创建广告点击工作表（含保护字段）');
  return adClickSheet;
}

/**
 * 为今日表格添加广告点击工作表（如果不存在）
 */
function initTodayAdClickSheet() {
  const dateString = getDateString();
  const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
  addAdClickSheetToExisting(dailySpreadsheet);
  
  return '已为今日表格添加广告点击工作表: ' + dailySpreadsheet.getUrl();
}

function testAdClick() {
  const testData = {
    eventType: 'ad_click',
    novel: 'The Queen\'s Rebirth',
    chapter: '4',
    pageUrl: 'https://novel.fkens.top/novels/the-queens-rebirth/chapter-4',
    adSlot: '2912660874',
    adPosition: '850',
    scrollDepth: '500',
    userIP: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
    screenSize: '390x844',
    stayDuration: 45,
    totalClickCount: 5,
    timestamp: new Date().toISOString()
  };
  
  const dateString = getDateString();
  const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
  
  // 确保广告点击工作表存在
  addAdClickSheetToExisting(dailySpreadsheet);
  
  handleAdClickEvent(dailySpreadsheet, testData);
  
  return '测试广告点击数据已写入: ' + dailySpreadsheet.getUrl();
}

// ==================== 辅助函数 ====================

/**
 * 获取设备类型
 */
function getDeviceType(userAgent) {
  if (!userAgent) return 'Unknown';
  
  if (/mobile/i.test(userAgent)) {
    if (/iphone/i.test(userAgent)) return 'iPhone';
    if (/android/i.test(userAgent)) return 'Android';
    return 'Mobile';
  }
  if (/tablet|ipad/i.test(userAgent)) return 'Tablet';
  return 'Desktop';
}

/**
 * 提取来源参数
 */
function extractSourceParams(url) {
  if (!url) return '';
  
  try {
    const urlObj = new URL(url);
    const params = [];
    
    if (urlObj.searchParams.get('utm_source')) {
      params.push('source=' + urlObj.searchParams.get('utm_source'));
    }
    if (urlObj.searchParams.get('utm_campaign')) {
      params.push('campaign=' + urlObj.searchParams.get('utm_campaign'));
    }
    if (urlObj.searchParams.get('fbclid')) {
      params.push('fb=yes');
    }
    
    return params.join(';');
  } catch (e) {
    return '';
  }
}

/**
 * 格式化保护剩余时间（毫秒转为小时:分钟）
 */
function formatProtectionTime(milliseconds) {
  if (!milliseconds || milliseconds <= 0) return '';
  
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours}h${minutes}m`;
}

/**
 * 测试防误触遮罩事件
 */
function testProtectionEvent() {
  const testData = {
    eventType: 'protection_activated',
    novel: 'The Queen\'s Rebirth',
    chapter: '4',
    pageUrl: 'https://novel.fkens.top/novels/the-queens-rebirth/chapter-4',
    clickTimeSpan: 6300,  // 105分钟
    protectionRemaining: 10800000,  // 3小时
    userIP: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (iPhone; Test)',
    screenSize: '390x844',
    timestamp: new Date().toISOString()
  };
  
  const dateString = getDateString();
  const dailySpreadsheet = getOrCreateDailySpreadsheet(dateString);
  
  addProtectionSheetToExisting(dailySpreadsheet);
  handleProtectionEvent(dailySpreadsheet, testData);
  
  return '测试防误触事件已写入: ' + dailySpreadsheet.getUrl();
}
