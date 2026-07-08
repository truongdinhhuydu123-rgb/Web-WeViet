const authModal = document.querySelector("#authModal");
const closeAuth = document.querySelector("#closeAuth");
const authButtons = document.querySelectorAll("[data-auth]");
const tabButtons = document.querySelectorAll("[data-tab]");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const cartButtons = document.querySelectorAll(".card button");
const toast = document.querySelector("#toast");
const bulkOrderForm = document.querySelector("#bulkOrderForm");
let toastTimer;

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

function encodeFormData(formData) {
    return new URLSearchParams(formData).toString();
}

function switchAuthTab(tabName) {
    tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tabName);
    });

    loginForm.classList.toggle("active", tabName === "login");
    registerForm.classList.toggle("active", tabName === "register");
}

function openAuth(tabName) {
    switchAuthTab(tabName);
    authModal.classList.add("open");
    authModal.setAttribute("aria-hidden", "false");
}

function hideAuth() {
    authModal.classList.remove("open");
    authModal.setAttribute("aria-hidden", "true");
}

authButtons.forEach((button) => {
    button.addEventListener("click", () => openAuth(button.dataset.auth));
});

tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchAuthTab(button.dataset.tab));
});

closeAuth.addEventListener("click", hideAuth);

authModal.addEventListener("click", (event) => {
    if (event.target === authModal) {
        hideAuth();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        hideAuth();
    }
});

cartButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const productName = button.closest(".card").querySelector("h3").textContent;
        showToast(`Đã thêm ${productName} vào giỏ hàng.`);
    });
});

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    hideAuth();
    showToast("Đăng nhập thành công. Chào mừng bạn quay lại!");
});

registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    hideAuth();
    showToast("Tạo tài khoản thành công!");
});

if (bulkOrderForm) {
    bulkOrderForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const quantityInput = bulkOrderForm.querySelector('input[name="quantity"]');
        const submitButton = bulkOrderForm.querySelector('button[type="submit"]');
        const quantity = Number(quantityInput.value);

        if (quantity < 100) {
            showToast("Đơn đặt may số lượng lớn bắt đầu từ 100 áo.");
            quantityInput.focus();
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Đang gửi...";

        try {
            const formData = new FormData(bulkOrderForm);
            const response = await fetch("/", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: encodeFormData(formData)
            });

            if (!response.ok) {
                throw new Error("Form submission failed");
            }

            bulkOrderForm.reset();
            showToast("Đã nhận yêu cầu báo giá. Đội ngũ sản xuất sẽ liên hệ bạn sớm!");
        } catch (error) {
            showToast("Chưa gửi được yêu cầu. Vui lòng thử lại hoặc liên hệ trực tiếp với We Viet.");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Gửi yêu cầu báo giá";
        }
    });
}
