import ctypes
from ctypes import wintypes
import xml.etree.ElementTree as ET


def enable_utf8_manifest(path):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    kernel.LoadLibraryExW.restype = wintypes.HMODULE
    kernel.FreeLibrary.argtypes = [wintypes.HMODULE]
    kernel.FindResourceExW.argtypes = [wintypes.HMODULE, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.WORD]
    kernel.FindResourceExW.restype = wintypes.HANDLE
    kernel.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.SizeofResource.restype = wintypes.DWORD
    kernel.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.LoadResource.restype = wintypes.HANDLE
    kernel.LockResource.argtypes = [wintypes.HANDLE]
    kernel.LockResource.restype = wintypes.LPVOID
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, wintypes.LPVOID, wintypes.LPVOID, wintypes.WORD, wintypes.LPARAM)
    kernel.EnumResourceLanguagesW.argtypes = [wintypes.HMODULE, wintypes.LPCWSTR, wintypes.LPCWSTR, callback_type, wintypes.LPARAM]
    kernel.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    kernel.BeginUpdateResourceW.restype = wintypes.HANDLE
    kernel.UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.WORD, wintypes.LPVOID, wintypes.DWORD]
    kernel.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    resource_type = ctypes.cast(24, wintypes.LPCWSTR)
    resource_name = ctypes.cast(1, wintypes.LPCWSTR)
    module = kernel.LoadLibraryExW(str(path), None, 2)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    manifests = {}
    try:
        languages = []

        @callback_type
        def collect_language(module_handle, kind, name, language, context):
            languages.append(language)
            return True

        if not kernel.EnumResourceLanguagesW(module, resource_type, resource_name, collect_language, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        for language in languages:
            resource = kernel.FindResourceExW(module, resource_type, resource_name, language)
            loaded = kernel.LoadResource(module, resource)
            pointer = kernel.LockResource(loaded)
            size = kernel.SizeofResource(module, resource)
            if not pointer or not size:
                raise ctypes.WinError(ctypes.get_last_error())
            manifest = ET.fromstring(ctypes.string_at(pointer, size))
            application_namespace = 'urn:schemas-microsoft-com:asm.v3'
            settings_namespace = 'http://schemas.microsoft.com/SMI/2019/WindowsSettings'
            application = manifest.find('{' + application_namespace + '}application')
            if application is None:
                application = ET.SubElement(manifest, '{' + application_namespace + '}application')
            settings = application.find('{' + application_namespace + '}windowsSettings')
            if settings is None:
                settings = ET.SubElement(application, '{' + application_namespace + '}windowsSettings')
            codepage = settings.find('{' + settings_namespace + '}activeCodePage')
            if codepage is None:
                codepage = ET.SubElement(settings, '{' + settings_namespace + '}activeCodePage')
            codepage.text = 'UTF-8'
            ET.register_namespace('', 'urn:schemas-microsoft-com:asm.v1')
            ET.register_namespace('asmv3', application_namespace)
            ET.register_namespace('ws2019', settings_namespace)
            manifests[language] = ET.tostring(manifest, encoding='utf-8', xml_declaration=True)
    finally:
        kernel.FreeLibrary(module)
    update = kernel.BeginUpdateResourceW(str(path), False)
    if not update:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for language, content in manifests.items():
            buffer = ctypes.create_string_buffer(content)
            if not kernel.UpdateResourceW(update, resource_type, resource_name, language, buffer, len(content)):
                raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        kernel.EndUpdateResourceW(update, True)
        raise
    if not kernel.EndUpdateResourceW(update, False):
        raise ctypes.WinError(ctypes.get_last_error())
