import zipfile
import os
source_list = ["icons", "js", "popup", "manifest.json"]

with zipfile.ZipFile("bookmark_flow.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for source in source_list:
        if os.path.isdir(source):
            for file in os.listdir(source):
                if (file.endswith("js") or file.endswith("html")) and ".min." not in file:
                    continue
                z.write(source + os.sep + file)
        else:
            z.write(source)

       
