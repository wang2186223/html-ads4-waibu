#!/usr/bin/env python3
"""
替换chapter.html中的广告监控系统
"""

# 读取简化版JS
with open('ad-click-simple.js', 'r', encoding='utf-8') as f:
    simple_code = f.read()

# 读取chapter.html
with open('tools/templates/chapter.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 找到广告监控系统的开始和结束标记
start_marker = '    <!-- ===== 广告点击监控系统'
end_marker = '    </script>\n    \n    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome'

start_pos = content.find(start_marker)
end_pos = content.find(end_marker)

if start_pos == -1 or end_pos == -1:
    print(f"❌ 找不到标记! start={start_pos}, end={end_pos}")
    exit(1)

# 准备新代码
new_code = f'''    <!-- ===== 广告点击监控系统（极简版 V2.0）===== -->
    <script>
    {simple_code.strip()}
    </script>
    
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome'''

# 替换
new_content = content[:start_pos] + new_code + content[end_pos + len(end_marker) - len('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome'):]

# 写回
with open('tools/templates/chapter.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("✅ 替换成功!")
print(f"   旧代码长度: {end_pos - start_pos} 字符")
print(f"   新代码长度: {len(new_code)} 字符")
