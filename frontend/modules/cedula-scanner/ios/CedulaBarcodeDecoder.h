#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN
@interface CedulaBarcodeDecoder : NSObject
// Returns decoded payload bytes, never PDF417 error-corrected codewords.
+ (nullable NSDictionary<NSString *, NSString *> *)decodePixelBuffer:(CVPixelBufferRef)buffer;
@end
NS_ASSUME_NONNULL_END
