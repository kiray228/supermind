# Дополняет проект Xcode тем, что нельзя удобно править вручную на Windows:
# свои Swift-файлы в цели App, права (App Group, HealthKit), расширение виджетов SuperMindWidget
# и общие с ним файлы (Shared/: таймер фокуса на экране блокировки).
# Запускается в CI на Mac перед сборкой (gem xcodeproj стоит вместе с CocoaPods). Повторный запуск ничего не меняет.
require 'xcodeproj'

ROOT = File.expand_path('../App', __dir__)
project = Xcodeproj::Project.open(File.join(ROOT, 'App.xcodeproj'))
app = project.targets.find { |t| t.name == 'App' } or abort('нет цели App')
app_group = project.main_group.find_subpath('App', false) or abort('нет группы App')

# 1. Swift-файлы приложения, которых ещё нет в цели (плагины, зарегистрированные в MainViewController)
Dir[File.join(ROOT, 'App', '*.swift')].sort.each do |path|
  name = File.basename(path)
  next if app.source_build_phase.files_references.any? { |r| r && r.path && File.basename(r.path) == name }
  ref = app_group.files.find { |f| f.path == name } || app_group.new_reference(name)
  app.add_file_references([ref])
  puts "App: + #{name}"
end

# 2. Права приложения
unless app_group.files.any? { |f| f.path == 'App.entitlements' }
  app_group.new_reference('App.entitlements')
end
app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
# 2а. Альтернативные иконки (Настройки → Оформление → «Иконка приложения»; наборы делает scripts/app-icons.mjs)
app.build_configurations.each do |c|
  c.build_settings['ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES'] = 'AppIcon-Dark AppIcon-Light AppIcon-Green AppIcon-Sunset AppIcon-Purple'
  c.build_settings['ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS'] = 'YES'
end
app.add_system_framework('HealthKit') unless app.frameworks_build_phase.files_references.any? { |r| r && r.path.to_s.end_with?('HealthKit.framework') }

# 2б. Переводы системных текстов (разрешения, быстрые действия): App/en.lproj, App/ru.lproj, App/kk.lproj
strings = app_group.children.find { |c| c.isa == 'PBXVariantGroup' && c.name == 'InfoPlist.strings' } ||
          app_group.new_variant_group('InfoPlist.strings')
%w[en ru kk].each do |l|
  path = "#{l}.lproj/InfoPlist.strings"
  next if strings.children.any? { |f| f.path == path }
  ref = strings.new_reference(path)
  ref.name = l
end
app.resources_build_phase.add_file_reference(strings, true)
regions = project.root_object.known_regions
%w[en ru kk Base].each { |r| regions << r unless regions.include?(r) }

# 2в. Siri и «Быстрые команды»: фразы (AppShortcuts.strings) и названия действий (Localizable.strings) — если файл есть
{ 'Localizable.strings' => %w[en ru kk], 'AppShortcuts.strings' => %w[en ru kk] }.each do |file, langs|
  present = langs.select { |l| File.exist?(File.join(ROOT, 'App', "#{l}.lproj", file)) }
  next if present.empty?
  vg = app_group.children.find { |c| c.isa == 'PBXVariantGroup' && c.name == file } || app_group.new_variant_group(file)
  present.each do |l|
    path = "#{l}.lproj/#{file}"
    next if vg.children.any? { |f| f.path == path }
    ref = vg.new_reference(path)
    ref.name = l
  end
  app.resources_build_phase.add_file_reference(vg, true)
end

# 3. Расширение виджетов
widget = project.targets.find { |t| t.name == 'SuperMindWidget' }
unless widget
  widget = project.new_target(:app_extension, 'SuperMindWidget', :ios, '17.0', nil, :swift)
  group = project.main_group.find_subpath('SuperMindWidget', true)
  group.set_source_tree('<group>')
  group.set_path('SuperMindWidget')
  swift = group.new_reference('SuperMindWidget.swift')
  group.new_reference('Info.plist')
  group.new_reference('SuperMindWidget.entitlements')
  widget.add_file_references([swift])
  %w[WidgetKit SwiftUI AppIntents].each { |f| widget.add_system_framework(f) }

  # встроить расширение в приложение
  app.add_dependency(widget)
  embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
          app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
  bf = embed.add_file_reference(widget.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts 'SuperMindWidget: цель создана'
end

# 4. Расширение «Поделиться» (текст, ссылки, картинки → очередь App Group → окно «Сохранить в SuperMind»)
share = project.targets.find { |t| t.name == 'ShareExtension' }
unless share
  share = project.new_target(:app_extension, 'ShareExtension', :ios, '16.4', nil, :swift)
  group = project.main_group.find_subpath('ShareExtension', true)
  group.set_source_tree('<group>')
  group.set_path('ShareExtension')
  swift = group.new_reference('ShareViewController.swift')
  group.new_reference('Info.plist')
  group.new_reference('ShareExtension.entitlements')
  share.add_file_references([swift])
  %w[Social UniformTypeIdentifiers].each { |f| share.add_system_framework(f) }
  app.add_dependency(share)
  embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
          app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
  bf = embed.add_file_reference(share.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts 'ShareExtension: цель создана'
end

# 5. Общие файлы приложения и расширения (таймер фокуса на экране блокировки: Live Activity и её кнопки)
shared = project.main_group.find_subpath('Shared', true)
shared.set_source_tree('<group>')
shared.set_path('Shared')
Dir[File.join(ROOT, 'Shared', '*.swift')].sort.each do |path|
  name = File.basename(path)
  ref = shared.files.find { |f| f.path == name } || shared.new_reference(name)
  [app, widget].each do |t|
    next if t.source_build_phase.files_references.include?(ref)
    t.add_file_references([ref])
    puts "#{t.name}: + Shared/#{name}"
  end
end

# 6. Остальные Swift-файлы виджетов (новые виджеты, кнопки Пункта управления) — в цель SuperMindWidget
wgroup = project.main_group.find_subpath('SuperMindWidget', true)
Dir[File.join(ROOT, 'SuperMindWidget', '*.swift')].sort.each do |path|
  name = File.basename(path)
  next if widget.source_build_phase.files_references.any? { |r| r && r.path && File.basename(r.path) == name }
  ref = wgroup.files.find { |f| f.path == name } || wgroup.new_reference(name)
  widget.add_file_references([ref])
  puts "SuperMindWidget: + #{name}"
end

app_settings = app.build_configurations.first.build_settings
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.twomind.mindmap.widget'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'SuperMindWidget/Info.plist'
  s['CODE_SIGN_ENTITLEMENTS'] = 'SuperMindWidget/SuperMindWidget.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SWIFT_VERSION'] = '5.0'
  s['SKIP_INSTALL'] = 'YES'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION'] || '1'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
end

share.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.twomind.mindmap.share'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
  s['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SWIFT_VERSION'] = '5.0'
  s['SKIP_INSTALL'] = 'YES'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION'] || '1'
end

project.save
puts 'Проект готов: ' + project.targets.map(&:name).join(', ')
