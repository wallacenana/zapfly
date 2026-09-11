<footer class="menu-footer-institutional">
    <div class="container">
        <div class="footer-links">
            <a href="/sobre">Sobre nós</a>
            <a href="/contato">Contato</a>
            <a href="/privacidade">Privacidade</a>
            <a href="/termos">Termos de uso</a>
        </div>
        <div class="footer-copyright">
            <p>&copy; <?php echo date('Y'); ?> Menzzu - Todos os direitos reservados</p>
        </div>
    </div>
</footer>

<style>
.menu-footer-institutional {
    padding: 40px 0 120px;
    background: transparent;
    text-align: center;
    border-top: 1px solid rgba(0,0,0,0.05);
    margin-top: 40px;
}
.footer-links {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}
.footer-links a {
    color: #666;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
}
.footer-links a:hover {
    color: var(--accent, #82F026);
}
.footer-copyright {
    color: #999;
    font-size: 0.75rem;
}
</style>
