/**
 * PUTs one photo straight to its server-minted signed upload URL. The URL
 * carries its own token, so the browser needs neither the Supabase client nor
 * the anon key. XHR rather than `fetch` because only XHR reports upload
 * progress. Kept in its own module so the form's browser test can mock it.
 */
export function uploadPhoto(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`Photo upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Photo upload failed"));
    xhr.onabort = () => reject(new Error("Photo upload aborted"));

    xhr.send(file);
  });
}
