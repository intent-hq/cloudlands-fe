// Dock-only AppKit cursor ownership. No global monitors, timers, or window activation.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

namespace {
struct Region {
  double x, y, width, height;
  bool operator==(const Region& other) const {
    return x == other.x && y == other.y && width == other.width && height == other.height;
  }
};
enum class Kind { None, Grab, Grabbing };

NSCursor* CursorFor(Kind kind) {
  return kind == Kind::Grab ? NSCursor.openHandCursor : NSCursor.closedHandCursor;
}

bool SameCursor(NSCursor* a, NSCursor* b) {
  if (!a || !b) return false;
  if (a == b || [a isEqual:b]) return true;
  // currentSystemCursor can be a separate NSCursor instance from the named cursor.
  return NSEqualPoints(a.hotSpot, b.hotSpot) &&
         [a.image.TIFFRepresentation isEqualToData:b.image.TIFFRepresentation];
}

const char* CursorName(NSCursor* cursor) {
  if (!cursor) return "none";
  if (SameCursor(cursor, NSCursor.openHandCursor)) return "grab";
  if (SameCursor(cursor, NSCursor.closedHandCursor)) return "grabbing";
  if (SameCursor(cursor, NSCursor.arrowCursor)) return "arrow";
  if (SameCursor(cursor, NSCursor.pointingHandCursor)) return "pointer";
  if (SameCursor(cursor, NSCursor.IBeamCursor)) return "text";
  return "other";
}
}  // namespace

@interface IntentDockCursorOwner : NSObject {
 @public
  __weak NSView* view;
  __weak NSWindow* attachedWindow;
  NSMutableArray<NSTrackingArea*>* areas;
  std::vector<Region> regions;
  std::vector<Region> excludedRegions;
  double revision;
  Kind kind;
  BOOL enabled;
  BOOL disposed;
  BOOL ownsCursor;
  NSCursor* appliedCursor;
  NSString* lastApplied;
  uint64_t setCount;
}
- (instancetype)initWithView:(NSView*)target;
- (NSPoint)localPoint;
- (BOOL)eligible;
- (void)refresh;
- (void)releaseCursor;
- (void)rebuildTracking;
- (void)dispose;
@end

@implementation IntentDockCursorOwner
- (instancetype)initWithView:(NSView*)target {
  if ((self = [super init])) {
    view = target;
    attachedWindow = target.window;
    areas = [NSMutableArray array];
    kind = Kind::None;
    lastApplied = @"none";
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(windowClosing:)
                                              name:NSWindowWillCloseNotification object:target.window];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(windowResized:)
                                              name:NSWindowDidResizeNotification object:target.window];
  }
  return self;
}
- (void)windowClosing:(NSNotification*)notification { [self dispose]; }
- (void)windowResized:(NSNotification*)notification {
  [self rebuildTracking];
  [self refresh];
}
- (NSPoint)localPoint {
  NSView* target = view;
  NSWindow* window = target.window;
  if (!target || !window) return NSZeroPoint;
  NSPoint p = [target convertPoint:[window convertPointFromScreen:NSEvent.mouseLocation] fromView:nil];
  return NSMakePoint(p.x - NSMinX(target.bounds),
                     target.isFlipped ? p.y - NSMinY(target.bounds) : NSMaxY(target.bounds) - p.y);
}
- (BOOL)eligible {
  NSView* target = view;
  NSWindow* window = target.window;
  if (disposed || !enabled || kind == Kind::None || !target || !window ||
      window != attachedWindow || !window.visible || window.miniaturized ||
      window.ignoresMouseEvents || target.hiddenOrHasHiddenAncestor) return NO;
  // A popup or another app can cover our view without changing its visible property.
  if ([NSWindow windowNumberAtPoint:NSEvent.mouseLocation belowWindowWithWindowNumber:0] !=
      window.windowNumber) return NO;
  NSPoint local = [self localPoint];
  for (const auto& r : excludedRegions) {
    if (local.x >= r.x && local.y >= r.y && local.x < r.x + r.width &&
        local.y < r.y + r.height) return NO;
  }
  bool inside = false;
  for (const auto& r : regions) {
    if (local.x >= r.x && local.y >= r.y && local.x < r.x + r.width &&
        local.y < r.y + r.height) { inside = true; break; }
  }
  if (!inside) return NO;
  NSPoint p = [window convertPointFromScreen:NSEvent.mouseLocation];
  NSView* root = window.contentView;
  NSPoint hitPoint = root.superview ? [root.superview convertPoint:p fromView:nil] : p;
  NSView* hit = [root hitTest:hitPoint];
  return hit && (hit == target || [hit isDescendantOf:target]);
}
- (void)releaseCursor {
  // Never overwrite a cursor another view/app installed after ours, including another hand.
  NSWindow* window = attachedWindow;
  if (ownsCursor && window &&
      [NSWindow windowNumberAtPoint:NSEvent.mouseLocation belowWindowWithWindowNumber:0] ==
          window.windowNumber && SameCursor(NSCursor.currentSystemCursor, appliedCursor) &&
      NSCursor.currentCursor == appliedCursor) {
    [NSCursor.arrowCursor set];
    lastApplied = @"arrow";
    ++setCount;
  }
  ownsCursor = NO;
  appliedCursor = nil;
}
- (void)refresh {
  if (![self eligible]) { [self releaseCursor]; return; }
  NSCursor* desired = CursorFor(kind);
  if (ownsCursor && appliedCursor == desired && SameCursor(NSCursor.currentSystemCursor, desired))
    return;
  [desired set];
  appliedCursor = desired;
  ownsCursor = YES;
  lastApplied = kind == Kind::Grab ? @"grab" : @"grabbing";
  ++setCount;
}
- (void)rebuildTracking {
  NSView* target = view;
  for (NSTrackingArea* area in areas) [target removeTrackingArea:area];
  [areas removeAllObjects];
  if (disposed || !enabled || kind == Kind::None || !target || target.window != attachedWindow)
    return;
  for (const auto& r : regions) {
    const NSRect bounds = target.bounds;
    NSRect rect = NSMakeRect(NSMinX(bounds) + r.x,
        target.isFlipped ? NSMinY(bounds) + r.y : NSMaxY(bounds) - r.y - r.height,
        r.width, r.height);
    rect = NSIntersectionRect(rect, target.visibleRect);
    if (NSIsEmptyRect(rect)) continue;
    // CursorUpdate is not delivered for ActiveAlways. Use AppKit's local mouse events.
    NSTrackingArea* area = [[NSTrackingArea alloc] initWithRect:rect
        options:NSTrackingActiveAlways | NSTrackingMouseEnteredAndExited |
                NSTrackingMouseMoved | NSTrackingEnabledDuringMouseDrag
        owner:self userInfo:nil];
    [target addTrackingArea:area];
    [areas addObject:area];
  }
}
- (void)mouseEntered:(NSEvent*)event {
  if (event.window == attachedWindow) [self refresh];
}
- (void)mouseMoved:(NSEvent*)event {
  if (event.window == attachedWindow) [self refresh];
}
- (void)mouseExited:(NSEvent*)event {
  if (event.window == attachedWindow) [self refresh];
}
- (void)dispose {
  if (disposed) return;
  disposed = YES;
  enabled = NO;
  [self releaseCursor];
  [self rebuildTracking];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  view = nil;
  attachedWindow = nil;
  regions.clear();
  excludedRegions.clear();
}
@end

namespace {
constexpr napi_type_tag kTokenTag = {0x1762f3e4ae7c4491ULL, 0xa9f7dac6a55ddc21ULL};
struct Environment;
struct Token {
  Environment* environment;
  IntentDockCursorOwner* __strong owner;
};
struct Environment { std::unordered_set<Token*> tokens; };

void Check(napi_env env, napi_status status) {
  if (status == napi_ok) return;
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, nullptr, "Dock cursor Node-API operation failed");
  throw std::runtime_error("Node-API failure");
}
void Require(napi_env env, bool condition, const char* message) {
  if (condition) return;
  napi_throw_type_error(env, nullptr, message);
  throw std::runtime_error(message);
}
napi_value Property(napi_env env, napi_value object, const char* key) {
  napi_value result;
  Check(env, napi_get_named_property(env, object, key, &result));
  return result;
}
double Number(napi_env env, napi_value object, const char* key) {
  double value;
  Check(env, napi_get_value_double(env, Property(env, object, key), &value));
  Require(env, std::isfinite(value) && std::abs(value) <= 1000000, "Invalid cursor rectangle number");
  return value;
}
Token* GetToken(napi_env env, napi_value value, Environment* environment) {
  bool valid = false;
  Check(env, napi_check_object_type_tag(env, value, &kTokenTag, &valid));
  Require(env, valid, "Invalid dock cursor token");
  void* data = nullptr;
  Check(env, napi_unwrap(env, value, &data));
  auto* token = static_cast<Token*>(data);
  Require(env, token && token->environment == environment, "Expired dock cursor environment");
  return token;
}
NSView* FindView(NSView* root, uintptr_t pointer) {
  if (reinterpret_cast<uintptr_t>((__bridge void*)root) == pointer) return root;
  for (NSView* child in root.subviews) {
    if (NSView* match = FindView(child, pointer)) return match;
  }
  return nil;
}
void Finalize(napi_env, void* data, void*) {
  auto* token = static_cast<Token*>(data);
  [token->owner dispose];
  if (token->environment) token->environment->tokens.erase(token);
  delete token;
}
void Cleanup(void* data) {
  auto* environment = static_cast<Environment*>(data);
  for (Token* token : environment->tokens) {
    [token->owner dispose];
    token->environment = nullptr;
  }
  delete environment;
}

napi_value Create(napi_env env, napi_value* args, Environment* environment) {
  bool isBuffer = false;
  Check(env, napi_is_buffer(env, args[0], &isBuffer));
  Require(env, isBuffer, "Expected native NSView handle Buffer");
  void* bytes;
  size_t length;
  Check(env, napi_get_buffer_info(env, args[0], &bytes, &length));
  Require(env, length == sizeof(uintptr_t), "Invalid native NSView handle length");
  uintptr_t pointer;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  NSView* view = nil;
  for (NSWindow* window in NSApp.windows) {
    view = FindView(window.contentView, pointer);
    if (view) break;
  }
  Require(env, view && view.window, "Native handle does not identify a live application view");
  for (Token* token : environment->tokens)
    Require(env, token->owner->disposed || token->owner->view != view, "View already has a cursor adapter");
  napi_value result;
  Check(env, napi_create_object(env, &result));
  Check(env, napi_type_tag_object(env, result, &kTokenTag));
  auto* token = new Token{environment, [[IntentDockCursorOwner alloc] initWithView:view]};
  if (!token->owner) { delete token; Require(env, false, "Cannot create dock cursor owner"); }
  napi_status status = napi_wrap(env, result, token, Finalize, nullptr, nullptr);
  if (status != napi_ok) { [token->owner dispose]; delete token; Check(env, status); }
  environment->tokens.insert(token);
  return result;
}
std::vector<Region> ParseRegions(napi_env env, napi_value list) {
  bool array = false;
  Check(env, napi_is_array(env, list, &array));
  Require(env, array, "Cursor regions must be an array");
  uint32_t count;
  Check(env, napi_get_array_length(env, list, &count));
  Require(env, count <= 64, "Too many cursor regions");
  std::vector<Region> regions;
  for (uint32_t i = 0; i < count; ++i) {
    napi_value object;
    Check(env, napi_get_element(env, list, i, &object));
    Region r{Number(env, object, "x"), Number(env, object, "y"),
             Number(env, object, "width"), Number(env, object, "height")};
    Require(env, r.width > 0 && r.height > 0 && r.width <= 16384 && r.height <= 16384,
            "Invalid cursor rectangle size");
    regions.push_back(r);
  }
  return regions;
}
napi_value Update(napi_env env, napi_value* args, Environment* environment) {
  Token* token = GetToken(env, args[0], environment);
  Require(env, !token->owner->disposed, "Dock cursor adapter is disposed");
  bool enabled;
  Check(env, napi_get_value_bool(env, Property(env, args[1], "enabled"), &enabled));
  char text[16];
  size_t length;
  Check(env, napi_get_value_string_utf8(env, Property(env, args[1], "kind"), text, sizeof(text), &length));
  Kind kind;
  if (std::strcmp(text, "grab") == 0 && length == 4) kind = Kind::Grab;
  else if (std::strcmp(text, "grabbing") == 0 && length == 8) kind = Kind::Grabbing;
  else { Require(env, std::strcmp(text, "none") == 0 && length == 4, "Invalid cursor kind"); kind = Kind::None; }
  auto regions = ParseRegions(env, Property(env, args[1], "regions"));
  std::vector<Region> excludedRegions;
  bool hasExcluded = false;
  Check(env, napi_has_named_property(env, args[1], "excludedRegions", &hasExcluded));
  if (hasExcluded) excludedRegions = ParseRegions(env, Property(env, args[1], "excludedRegions"));
  double revision = token->owner->revision;
  bool hasRevision = false;
  Check(env, napi_has_named_property(env, args[1], "revision", &hasRevision));
  if (hasRevision) {
    Check(env, napi_get_value_double(env, Property(env, args[1], "revision"), &revision));
    Require(env, std::isfinite(revision) && revision >= 0 && revision <= 9007199254740991.0 &&
                 std::floor(revision) == revision, "Invalid cursor revision");
  }
  IntentDockCursorOwner* owner = token->owner;
  // Property getters can re-enter the module and dispose the token while parsing.
  Require(env, !owner->disposed, "Dock cursor adapter was disposed during update");
  if (owner->enabled != enabled || owner->kind != kind || owner->regions != regions ||
      owner->excludedRegions != excludedRegions || owner->revision != revision) {
    owner->enabled = enabled;
    owner->kind = kind;
    owner->regions = std::move(regions);
    owner->excludedRegions = std::move(excludedRegions);
    owner->revision = revision;
    [owner rebuildTracking];
    [owner refresh];
  }
  napi_value result;
  Check(env, napi_get_undefined(env, &result));
  return result;
}
napi_value Dispose(napi_env env, napi_value* args, Environment* environment) {
  [GetToken(env, args[0], environment)->owner dispose];
  napi_value result;
  Check(env, napi_get_undefined(env, &result));
  return result;
}
void Set(napi_env env, napi_value object, const char* key, bool value) {
  napi_value result; Check(env, napi_get_boolean(env, value, &result));
  Check(env, napi_set_named_property(env, object, key, result));
}
void Set(napi_env env, napi_value object, const char* key, double value) {
  napi_value result; Check(env, napi_create_double(env, value, &result));
  Check(env, napi_set_named_property(env, object, key, result));
}
void Set(napi_env env, napi_value object, const char* key, const char* value) {
  napi_value result; Check(env, napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result));
  Check(env, napi_set_named_property(env, object, key, result));
}
napi_value Inspect(napi_env env, napi_value* args, Environment* environment) {
  IntentDockCursorOwner* owner = GetToken(env, args[0], environment)->owner;
  NSWindow* window = owner->view.window;
  napi_value result, point, screenPoint;
  Check(env, napi_create_object(env, &result));
  Check(env, napi_create_object(env, &point));
  Check(env, napi_create_object(env, &screenPoint));
  NSPoint p = [owner localPoint];
  Set(env, point, "x", double(p.x)); Set(env, point, "y", double(p.y));
  Check(env, napi_set_named_property(env, result, "point", point));
  // AppKit screen coordinates (bottom-left origin), not Electron's synthetic test cursor.
  NSPoint actualScreenPoint = NSEvent.mouseLocation;
  Set(env, screenPoint, "x", double(actualScreenPoint.x));
  Set(env, screenPoint, "y", double(actualScreenPoint.y));
  Check(env, napi_set_named_property(env, result, "screenPoint", screenPoint));
  Set(env, result, "windowKey", bool(window.keyWindow));
  Set(env, result, "windowVisible", bool(window.visible));
  Set(env, result, "interactive", bool(window && !window.ignoresMouseEvents));
  Set(env, result, "currentSystemCursor", CursorName(NSCursor.currentSystemCursor));
  Set(env, result, "processCurrent", CursorName(NSCursor.currentCursor));
  Set(env, result, "systemCursorMatchesRequested", owner->kind != Kind::None &&
      SameCursor(NSCursor.currentSystemCursor, CursorFor(owner->kind)));
  Set(env, result, "lastApplied", owner->lastApplied.UTF8String);
  Set(env, result, "setCount", double(owner->setCount));
  Set(env, result, "revision", owner->revision);
  Set(env, result, "excludedRegionCount", double(owner->excludedRegions.size()));
  Set(env, result, "disposed", bool(owner->disposed));
  Set(env, result, "tracking", owner->areas.count != 0);
  Set(env, result, "ownsCursor", bool(owner->ownsCursor &&
      SameCursor(NSCursor.currentSystemCursor, owner->appliedCursor)));
  return result;
}

template <napi_value (*Function)(napi_env, napi_value*, Environment*), size_t Count>
napi_value Call(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    @try {
      try {
        Require(env, NSThread.isMainThread, "Dock cursor requires the AppKit main thread");
        napi_value args[Count + 1];
        size_t count = Count + 1;
        void* data;
        Check(env, napi_get_cb_info(env, info, &count, args, nullptr, &data));
        Require(env, count == Count, "Invalid dock cursor argument count");
        return Function(env, args, static_cast<Environment*>(data));
      } catch (const std::exception& error) {
        bool pending = false; napi_is_exception_pending(env, &pending);
        if (!pending) napi_throw_error(env, nullptr, error.what());
      }
    } @catch (NSException* exception) {
      napi_throw_error(env, nullptr, exception.reason.UTF8String);
    }
  }
  return nullptr;
}
napi_value Initialize(napi_env env, napi_value exports) {
  if (!NSThread.isMainThread) {
    napi_throw_error(env, nullptr, "Dock cursor must load on the AppKit main thread");
    return nullptr;
  }
  auto* environment = new Environment;
  if (napi_add_env_cleanup_hook(env, Cleanup, environment) != napi_ok) {
    delete environment;
    napi_throw_error(env, nullptr, "Cannot register dock cursor cleanup");
    return nullptr;
  }
  const napi_property_descriptor methods[] = {
    {"create", nullptr, Call<Create, 1>, nullptr, nullptr, nullptr, napi_default, environment},
    {"update", nullptr, Call<Update, 2>, nullptr, nullptr, nullptr, napi_default, environment},
    {"dispose", nullptr, Call<Dispose, 1>, nullptr, nullptr, nullptr, napi_default, environment},
    {"inspect", nullptr, Call<Inspect, 1>, nullptr, nullptr, nullptr, napi_default, environment},
  };
  if (napi_define_properties(env, exports, 4, methods) != napi_ok) {
    napi_throw_error(env, nullptr, "Cannot export dock cursor methods");
    return nullptr;
  }
  return exports;
}
}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
