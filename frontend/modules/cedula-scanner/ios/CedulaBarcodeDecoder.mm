#import "CedulaBarcodeDecoder.h"
#include "ReadBarcode.h"
#include "BarcodeFormat.h"

@implementation CedulaBarcodeDecoder
+ (NSDictionary<NSString *, NSString *> *)decodePixelBuffer:(CVPixelBufferRef)buffer {
  if (!CVPixelBufferIsPlanar(buffer) || CVPixelBufferGetPlaneCount(buffer) < 1) return nil;
  if (CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return nil;
  NSDictionary *output = nil;
  @try {
    try {
      const auto *base = static_cast<const uint8_t *>(CVPixelBufferGetBaseAddressOfPlane(buffer, 0));
      const int width = static_cast<int>(CVPixelBufferGetWidthOfPlane(buffer, 0));
      const int height = static_cast<int>(CVPixelBufferGetHeightOfPlane(buffer, 0));
      const int stride = static_cast<int>(CVPixelBufferGetBytesPerRowOfPlane(buffer, 0));
      if (base && width > 0 && height > 0) {
        auto options = ZXing::ReaderOptions().setFormats(ZXing::BarcodeFormat::PDF417 | ZXing::BarcodeFormat::QRCode)
          .setTryHarder(true).setTryRotate(true).setTryInvert(true);
        const auto results = ZXing::ReadBarcodes(ZXing::ImageView(base, width, height, ZXing::ImageFormat::Lum, stride), options);
        for (const auto &result : results) {
          if (!result.isValid() || result.bytes().empty()) continue;
          const auto &bytes = result.bytes();
          NSString *raw = nil;
          if (result.format() == ZXing::BarcodeFormat::PDF417) {
            raw = [[NSString alloc] initWithBytes:bytes.data() length:bytes.size() encoding:NSISOLatin1StringEncoding];
          } else {
            raw = [[NSString alloc] initWithBytes:bytes.data() length:bytes.size() encoding:NSUTF8StringEncoding];
          }
          if (raw.length) {
            output = @{ @"raw": raw, @"type": result.format() == ZXing::BarcodeFormat::PDF417 ? @"pdf417" : @"qr" };
            break;
          }
        }
      }
    } catch (...) { /* An undecodable frame is not a camera failure. */ }
  } @finally {
    CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
  }
  return output;
}
@end
