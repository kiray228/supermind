# Дополняет проект Xcode тем, что нельзя удобно править вручную на Windows:
# свои Swift-файлы в цели App, права (App Group, HealthKit) и расширение виджетов SuperMindWidget.
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
app.add_system_framework('HealthKit') unless app.frameworks_build_phase.files_references.any? { |r| r && r.path.to_s.end_with?('HealthKit.framework') }

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

project.save
puts 'Проект готов: ' + project.targets.map(&:name).join(', ')
