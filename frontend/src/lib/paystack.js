let scriptPromise = null;

function loadScript() {
  if (window.PaystackPop) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Failed to load Paystack'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function payWithPaystack({
  key,
  email,
  amountKobo,
  reference,
  metadata = {},
  onSuccess,
  onCancel,
}) {
  await loadScript();

  const handler = window.PaystackPop.setup({
    key,
    email,
    amount: amountKobo,
    ref: reference,
    metadata,
    callback: (response) => {
      if (typeof onSuccess === 'function') onSuccess(response.reference);
    },
    onClose: () => {
      if (typeof onCancel === 'function') onCancel();
    },
  });

  handler.openIframe();
}
