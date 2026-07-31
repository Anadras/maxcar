# MAXCAR tablet app. Default AGP/Compose rules cover the vast majority of
# what this module needs; add rules here only when R8 actually strips
# something real (reflection-based serialization models, Room entities).

-keepattributes *Annotation*
-keepclassmembers class com.maxcar.tablet.data.remote.** { *; }
