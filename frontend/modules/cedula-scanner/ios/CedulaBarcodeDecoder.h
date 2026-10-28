#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN
@interface CedulaBarcodeDecoder : NSObject
// Returns decoded payload bytes, never PDF417 error-corrected codewords.
+ (nullable NSDictionary<NSString *, NSString *> *)decodePixelBuffer:(CVPixelBufferRef)buffer NS_SWIFT_NAME(decodePixelBuffer(_:));
@end
NS_ASSUME_NONNULL_END
