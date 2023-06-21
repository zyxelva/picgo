// 适配pjax
function whenDOMReady() {
    // Memos Start
    var memo = {
        host: 'https://demo.usememos.com/',
        limit: '10',
        creatorId: '101',
        domId: '#memos',
        username: 'Admin',
        name: 'Administrator'
    }
    if (typeof (memos) !== "undefined") {
        for (var key in memos) {
            if (memos[key]) {
                memo[key] = memos[key];
            }
        }
    }
    var memoUrl = memo.host + "api/memo?creatorId=" + memo.creatorId + "&tag=相册"
    if (location.pathname === '/photos/') {
        photos(memoUrl);
    }
}

whenDOMReady()
document.addEventListener("pjax:complete", whenDOMReady)

// 自适应
window.onresize = () => {
    if (location.pathname === '/photos/') {
        waterfall('.gallery-photos');
    }
};

// 函数
function photos(memoUrl) {
    fetch(memoUrl).then(res => res.json()).then(data => {
        let html = '', imgs = [];
        data.data.forEach(item => {
            //提取``` ```包裹的图片
            imgs = imgs.concat(item.content.match(/\!\[.*?\]\(.*?\)/g))
        });

        imgs.forEach(item => {
            if (item) {
                let img = item.replace(/!\[.*?\]\((.*?)\)/g, '$1'),
                    time, title, tat = item.replace(/!\[(.*?)\]\(.*?\)/g, '$1');
                if (tat.indexOf(' ') !== -1) {
                    time = tat.split(' ')[0];
                    title = tat.split(' ')[1];
                } else title = tat

                html += `<div class="gallery-photo"><a href="${img}" data-fancybox="gallery" class="fancybox" data-thumb="${img}"><img class="photo-img" loading='lazy' decoding="async" src="${img}"></a>`;
                title ? html += `<span class="photo-title">${title}</span>` : '';
                time ? html += `<span class="photo-time">${time}</span>` : '';
                html += `</div>`;
            }
        });

        document.querySelector('.gallery-photos.page').innerHTML = html
        imgStatus.watch('.photo-img', () => {
            waterfall('.gallery-photos');
        });
        window.Lately && Lately.init({target: '.photo-time'});
    }).catch()
}
