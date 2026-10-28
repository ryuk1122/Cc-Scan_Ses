Pod::Spec.new do |s|
  s.name = 'CedulaScanner'
  s.version = '1.0.0'
  s.summary = 'Local MRZ and PDF417 camera for CedulaScan Pro'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'CedulaScan'
  s.homepage = 'https://github.com/ryuk1122/Cc-Scan_Ses'
  s.source = { :git => 'https://github.com/ryuk1122/Cc-Scan_Ses.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision', 'CoreImage', 'CoreVideo'
  s.source_files = '*.{swift,h,mm}', 'vendor/zxing/core/src/**/*.{cpp,c}'
  s.public_header_files = 'CedulaBarcodeDecoder.h'
  s.resources = 'ZXING-LICENSE.txt'
  s.preserve_paths = 'vendor/zxing/core/src/**/*.h', 'vendor/zxing/LICENSE', 'vendor/zxing/NOTICE'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/vendor/zxing/core/src"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) ZXING_BUILD_READERS ZXING_BUILD_WRITERS',
    'SWIFT_STRICT_CONCURRENCY' => 'minimal'
  }
end
