/**
 * TRADIE MASTER ENGINE
 * Handcrafted by WynnPages
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. MAGNETIC BUTTONS EFFECT
    // Tạo cảm giác cao cấp khi con trỏ chuột đến gần nút bấm
    const magnetics = document.querySelectorAll('.magnetic');
    
    magnetics.forEach(magnetic => {
        magnetic.addEventListener('mousemove', (e) => {
            const bound = magnetic.getBoundingClientRect();
            const strength = magnetic.dataset.strength || 20;
            
            const x = (e.clientX - bound.left - bound.width / 2) / bound.width * strength;
            const y = (e.clientY - bound.top - bound.height / 2) / bound.height * strength;
            
            // Di chuyển nút
            magnetic.style.transform = `translate(${x}px, ${y}px)`;
            
            // Di chuyển text bên trong (Parallax nội bộ)
            const text = magnetic.querySelector('.btn-text');
            if(text) {
                text.style.transform = `translate(${x * 0.5}px, ${y * 0.5}px)`;
            }
        });
        
        magnetic.addEventListener('mouseleave', () => {
            magnetic.style.transform = 'translate(0px, 0px)';
            const text = magnetic.querySelector('.btn-text');
            if(text) {
                text.style.transform = 'translate(0px, 0px)';
            }
        });
    });

    // 2. GLASSSMORPHISM SPOTLIGHT (HOVER GLOW)
    // Ánh sáng chạy theo con trỏ chuột trên các thẻ
    const cards = document.querySelectorAll('.interactive-card');
    
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });

    // 3. SCROLL REVEAL ANIMATIONS
    // Sử dụng IntersectionObserver thay vì thư viện ngoài để nhẹ site
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target); // Chỉ chạy 1 lần
            }
        });
    }, observerOptions);

    const revealElements = document.querySelectorAll('.reveal');
    revealElements.forEach(el => observer.observe(el));

    // 4. HEADER SHRINK ON SCROLL
    const header = document.querySelector('.header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'var(--bg-surface)';
            header.style.border = '1px solid var(--border-color)';
            header.style.padding = '8px 24px';
            header.style.backdropFilter = 'blur(20px)';
        } else {
            // header.style.background = 'transparent';
            header.style.border = '1px solid var(--border-color)';
            header.style.padding = '0';
        }
    });
});
